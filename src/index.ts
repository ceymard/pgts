
import { autoserializeAs as aa, autoserialize as a, Deserialize, Serialize, } from "cerialize"
export * from "cerialize"
export * as s from "./serializers"

export type JSONValue =
    | null
    | string
    | number
    | boolean
    | { [x: string]: JSONValue }
    | JSONValue[]

export type Json = any
export type Jsonb = Json


export type ModelMaker<T extends Model> = {new(...a: any): T} & Pick<typeof Model, keyof typeof Model>

export const sym_count = Symbol("count")
export type RequestCount = {total: number, first: number, last: number}

function to_update_arg(v: any) {
  if (v == null) return "is.null"
  if (v instanceof Date) return `eq.${encodeURIComponent(v.toJSON())}`
  // if (typeof v === "string") return `eq."${v.replace(/"/g, "\\\"")}"`
  if (typeof v === "boolean") return `is.${v}`
  return `eq.${encodeURIComponent(v)}`
}

export function FETCH(input: RequestInfo, init?: RequestInit): Promise<Response> {
  return fetch(input, init).then(res => {
    if (res.status < 200 || res.status >= 400)
      return Promise.reject(res)
    return res
  })
}


export function GET(schema: string, url: string, opts: { exact_count?: boolean } = { }) {
  return FETCH(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Accept-Profile": schema,
      ...(opts.exact_count ? { Prefer: "count=exact" } : {}),
    },
    credentials: "include"
  }).then(async res => {
    const head = res.headers.get("Content-Range")
    const result = await res.json()
    if (opts.exact_count && head) {
      const [strbegin, strtotal] = head.split("/")
      const total = parseInt(strtotal)
      const [strfirst, strlast] = strbegin.split("-")
      const first = parseInt(strfirst)
      const last = parseInt(strlast)
      const pagecount = total / (first - last + 1)
      ;(result as any)[sym_count] = {total, first, last, pagecount}
    } else {
      ;(result as any)[sym_count] = {total: NaN, first: NaN, last: NaN, pagecount: NaN}
    }
    return result
  })
}

export function DELETE(schema: string, url: string) {
  return FETCH(url, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Accept-Profile": schema,
    },
    credentials: "include"
  }).then(res => {
    return res.text() as any
  })
}



export async function POST(schema: string, url: string, body: any = {}, opts: { } = {}): Promise<any> {
  return FETCH(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Accept-Profile": schema,
    },
    credentials: "include",
    body: body
  }).then(r => r.json())
}



export abstract class Model {

  get __model(): ModelMaker<any> { return this.constructor as any }
  __old_pk: any[] | undefined
  abstract get __pk(): any[] | undefined

  static url: string = ""
  static schema = "no-schema"

  static csv_helper: any = {}
  static columns: string[] = []

  static OnDeserialized(inst: Model) {
    const pk = inst.__pk
    if (pk) {
      inst.__old_pk = pk
    }
  }

  static async get<T extends Model>(this: ModelMaker<T>, supl: string = "", opts: { exact_count?: boolean } = {}): Promise<T[] & {[sym_count]: RequestCount}> {
    // const ret = this as any as (new () => T)
    const res = await GET(this.schema, this.url + supl, { ...opts, })
    const res_t = Deserialize(res, this)
    if (opts.exact_count && (res as any)[sym_count]) res_t[sym_count] = (res as any)[sym_count]
    return res_t
  }

  static async remove<T extends Model>(this: ModelMaker<T>, supl: string) {
    if (!supl)
      throw new Error("suppl cannot be empty")
    if (supl[0] !== "?") supl = "?" + supl
    const res = await DELETE(this.schema, this.url + supl)
    return res
  }

  static async saveMany<T extends Model>(this: ModelMaker<T>, models: T[]) {
    if (!models.length) return []

    const heads = new Headers({
      Accept: "application/json",
      Prefer: "resolution=merge-duplicates",
      "Content-Type": "application/json",
      "Accept-Profile": this.schema,
    })
    heads.append("Prefer", "return=representation")

    const res = await FETCH(this.url, {
      method: "POST",
      headers: heads,
      credentials: "include",
      body: JSON.stringify(models.map(m => Serialize(m, this)))
    })

    const res_t = Deserialize((await res.json()), this) as T[]
    return res_t
  }

  protected async doSave(url: string, method: string): Promise<this> {
    const heads = new Headers({
      Accept: "application/json",
      Prefer: "resolution=merge-duplicates",
      "Content-Type": "application/json",
      "Accept-Profile": this.__model.schema,
    })
    heads.append("Prefer", "return=representation")
    const res = await FETCH(url, {
      method: method,
      headers: heads,
      credentials: "include",
      body: JSON.stringify(Serialize(this, this.__model))
    })

    const payload = (await res.json())[0]
    const n = Deserialize(payload, this.__model)
    return n
  }

  /**
   * Save upserts the record.
   */
  async save() {
    if (this.__old_pk)
      return this.update()
    return this.doSave(this.__model.url, "POST")
  }

  /**
   * Update just updates the record.
   */
  async update(...keys: (keyof this)[]): Promise<this> {
    const parts: string[] = []
    const cst = this.__model
    const pk = this.__pk

    if (!pk || pk.length === 0 || !this.__old_pk) {
      throw new Error("can't instance-update an item without primary key")
    }
    for (let i = 0; i < pk.length; i++) {
      parts.push(`${pk[i]}=${to_update_arg(this.__old_pk[i])}`)
    }

    if (keys.length) {
      parts.push(`columns=${keys.join(",")}`)
    }

    return this.doSave(cst.url + (parts.length ? `?${parts.join("&")}` : ""), "PATCH")
  }

  async delete(): Promise<Response> {
    const cst = this.__model
    if (!this.__pk || this.__pk.length === 0) {
      throw new Error("can't instance-delete an item without primary key")
    }
    const parts: string[] = []
    for (const pk of this.__pk) {
      parts.push(`${pk}=${to_update_arg((this as any)[pk])}`)
    }
    return FETCH(`${cst.url}?${parts.join("&")}`, {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Accept-Profile": cst.schema,
      }
    })
  }

  static async createInDb<T extends Model>(this: new () => T, vals: any): Promise<T> {
    const val = new this()
    Object.assign(val, vals)
    return await val.save()
  }

  static create<T extends Model>(this: new () => T, defs: any) {
    const val = new this()
    Object.assign(val, defs)
    return val
  }
}
