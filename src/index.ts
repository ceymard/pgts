
import * as s from "@salesway/scotty"
export * as s from "@salesway/scotty"
export * from "./types"

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
      // Accept: "application/json",
      "Accept": "application/vnd.pgrst.array+json;nulls=stripped",
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
  }).then(r => {
    if (r.status === 204) return undefined
    const ct = r.headers.get("Content-Type")
    if (ct != null && ct.indexOf("application/json") !== -1) {
      return r.json()
    } else {
      return r.text()
    }
  })
}


export interface Column {
  type: string

  is_array?: boolean
  nullable?: boolean
  default_xp?: string
  pk?: boolean
}

export interface PgtsMeta<M extends Model> {
  url: string
  schema: string

  columns: {[name in keyof M]?: Column}
  pk_fields: string[]
  roles?: Roles
}

export class Roles {
  _roles = new Map<string, string>()

  anyRoleCan(roles: Set<string>, perms?: string) {
    for (let r of roles) {
      const role = this._roles.get(r)
      if (role == null) continue
      if (perms == undefined) return true
      for (let p of perms) {
        if (role.includes(p)) return true
      }
    }
    return false
  }

  rol(name: string, perms: string) {
    this._roles.set(name, perms)
    return this
  }
}

export function rol(name: string, perms: string): Roles {
  return new Roles().rol(name, perms)
}


export abstract class Model {

  [s.sym_on_deserialized]() {
    const pk = this.__pk
    if (pk != null) {
      this.__old_pk = pk
    }
  }

  static meta: PgtsMeta<Model>
  abstract get __meta(): PgtsMeta<this>

  get __model() { return this.constructor as new() => this }
  get __pk(): {[name: string]: any} | undefined { return undefined }
  __old_pk: {[name: string]: any} | undefined

  resetPk() {
    this.__old_pk = undefined
  }

  static async get<T extends Model>(this: ModelMaker<T>, supl: string = "", opts: { exact_count?: boolean } = {}): Promise<T[]> {
    // const ret = this as any as (new () => T)
    const meta = this.meta
    const res = await GET(meta.schema, meta.url + supl, { ...opts, })
    const res_t = s.deserialize(res, this)
    if (opts.exact_count && (res as any)[sym_count]) (res_t as any)[sym_count] = (res as any)[sym_count]
    return res_t as any
  }

  static async remove<T extends Model>(this: ModelMaker<T>, supl: string) {
    const meta = this.meta
    if (!supl)
      throw new Error("suppl cannot be empty")
    if (supl[0] !== "?") supl = "?" + supl
    const res = await DELETE(meta.schema, meta.url + supl)
    return res
  }

  static async saveMany<T extends Model>(this: ModelMaker<T>, models: T[]) {
    if (!models.length) return []

    const meta = this.meta
    const heads = new Headers({
      Accept: "application/json",
      Prefer: "resolution=merge-duplicates",
      "Content-Type": "application/json",
      "Accept-Profile": meta.schema,
    })
    heads.append("Prefer", "return=representation")

    const res = await FETCH(meta.url, {
      method: "POST",
      headers: heads,
      credentials: "include",
      body: JSON.stringify(models.map(m => s.serialize(m)))
    })

    const res_t = s.deserialize((await res.json() as unknown[]), this) as T[]
    return res_t
  }

  protected async doSave(url: string, method: string): Promise<this> {
    const meta = this.__meta
    const heads = new Headers({
      Accept: "application/json",
      Prefer: "resolution=merge-duplicates",
      "Content-Type": "application/json",
      "Accept-Profile": meta.schema,
    })
    heads.append("Prefer", "return=representation")
    const res = await FETCH(url, {
      method: method,
      headers: heads,
      credentials: "include",
      body: JSON.stringify(s.serialize(this))
    })

    const payload = (await res.json())[0]
    const n = s.deserialize(payload, this.__model)
    return n
  }

  /**
   * Save upserts the record.
   */
  async save() {
    if (this.__old_pk)
      return this.update()
    return this.doSave(this.__meta.url, "POST")
  }

  /**
   * Update just updates the record.
   */
  async update(...keys: (keyof this)[]): Promise<this> {
    const parts: string[] = []
    const cst = this.__model
    const pk = this.__pk

    if (!pk || Object.keys(pk).length === 0 || !this.__old_pk) {
      throw new Error("can't instance-update an item without primary key")
    }
    for (let x in pk) {
      parts.push(`${x}=${to_update_arg(this.__old_pk[x])}`)
    }

    if (keys.length) {
      parts.push(`columns=${keys.join(",")}`)
    }

    return this.doSave(this.__meta.url + (parts.length ? `?${parts.join("&")}` : ""), "PATCH")
  }

  async delete(): Promise<Response> {
    const pk = this.__pk
    if (!pk || Object.keys(pk).length === 0) {
      throw new Error("can't instance-delete an item without primary key")
    }
    const parts: string[] = []
    for (const x in this.__pk) {
      parts.push(`${x}=${to_update_arg((this as any)[x])}`)
    }
    const meta = this.__meta
    return FETCH(`${meta.url}?${parts.join("&")}`, {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Accept-Profile": meta.schema,
      }
    })
  }

  static async createInDb<T extends Model>(this: ModelMaker<T>, defs: any): Promise<T> {
    const val = new this()
    for (const name of Object.keys(this.meta.columns)) {
      if (defs[name] !== undefined) {
        val[name as keyof T] = defs[name]
      }
    }
    return await val.save()
  }

  static create<T extends Model>(this: ModelMaker<T>, defs: any) {
    const val = new this()
    for (const name of Object.keys(this.meta.columns)) {
      if (defs[name] !== undefined) {
        val[name as keyof T] = defs[name]
      }
    }
    return val
  }
}
