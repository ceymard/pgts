
import { autoserializeAs as aa, autoserialize as a, Deserialize, Serialize, __TypeMap, ISerializable } from "cerialize"
export * from "cerialize"
export * as s from "./serializers"

export type JSONValue =
    | null
    | string
    | number
    | boolean
    | { [x: string]: JSONValue }
    | JSONValue[]

interface ConcreteDeserializer {
  name: string
  deserialize: (m: any) => any
}

interface MetaValue {
  deserializedKey: string
  deserializedType: ISerializable
  indexable: false
  keyName: string
  serializedKey: string
  serializedType: ISerializable
}

function _csv_obj(model: ModelMaker<any>, cols: ConcreteDeserializer[]) {
  return function (str: string) {
    let in_quote = false
    let field_idx = 0
    let res = new model()

    if (str[0] !== '(') throw new Error("not an object")
    loop: for (let i = 1, start = 1, l = str.length; i < l; i++) {
      const ch = str[i]
      switch (ch) {
        case '"':
          if (in_quote === false) {
            in_quote = true
          } else {
            if (str[i+1] === '"') {
              i++
              continue
            } else {
              in_quote = false
            }
          }
          continue
        case ')':
        case ',':
          let word = start === i ? null : ""+str.slice(start, i)
          if (word != null && word[0] === '"') word = word.slice(1, -1)
          const col = cols[field_idx++]
          start = i + 1

          word = col.deserialize?.(word) ?? word
          res[col.name] = word
      }
    }
    model.OnDeserialized(res)
    return res
  }
}

function _csv_array(model?: ModelMaker<any>) {
  let obj = model ? _csv_obj(model) : null

  return function _csv_array(a: any) {
    if (typeof a !== "string") return a
    if (a[0] === "[") return JSON.parse(a)
    if (a[0] !== "{") throw new Error("unknown array type")
    a = a.slice(1, -1)

    let in_quote = false
    let res: any[] = []

    for (let i = 0, start = 0, l = a.length; i <= l; i++) {
      const ch = a[i]
      switch (ch) {
        case '"':
          if (!in_quote) {
            in_quote = true
          } else {
            if (a[i+1] === '"') {
              i++
              continue
            } else {
              in_quote = false
            }
          }
          continue
        case ',':
        case undefined:
          if (in_quote) continue
          let item: any = start === i ? null : ""+a.slice(start, i)
          if (item != null && item[0] === '"') item = item.slice(1, -1).replace(/""/g, '"') // unquote
          start = i + 1
          if (obj) {
            item = obj(item)
          }
          if (i > 0) res.push(item)
      }
    }

    return res
  }
}


function csv_get_deserializables(model: ModelMaker<any>) {
  const meta = __TypeMap.get(model) as MetaValue[]
  const res = meta.map(m => {
    let deser = m.deserializedType
    let fn: ConcreteDeserializer = {name: m.keyName, deserialize: m => m}
    if (__TypeMap.has(deser)) {
      const _d = deser as ModelMaker<any>
      let _ = csv_get_deserializables(_d)
      fn.deserialize = _csv_obj(_d, _)
    } else if (deser != null && deser.Deserialize) {
      fn.deserialize = deser.Deserialize!
    }
    return fn
  })

  return res
}

async function uncsv(res: Response, model?: ModelMaker<any>): Promise<any[]> {
  const txt = await res.text()
  const objs: any[] = []
  let headers: string[] = undefined!
  let line: (string | null)[] = []

  const des = model ? csv_get_deserializables(model) : []
  const mpdes = new Map(des.map(d => [d.name, d]))

  let i = 0
  let start = 0
  let len = txt.length
  let in_quote = false
  let line_non_null = false

  for (; i < len + 1; i++) {
    let c = txt[i]
    switch (c) {
      case '"':
        if (in_quote) {
          if (txt[i+1] === '"') {
            i++
          } else {
            in_quote = false
          }
        } else {
          in_quote = true
        }
        continue
      case undefined:
      case ',':
      case '\n':
        if (in_quote) continue
        let word: string | null = null
        if (i > start) {
          word = txt[start] === '"' ? txt.slice(start + 1, i - 1) : txt.slice(start, i)
          word = word.replace(/""/g, '"')
          line_non_null = true
        }
        start = i + 1
        line.push(word)

        if (c === '\n' || c === undefined) {
          if (!line_non_null) continue // ignore empty lines
          if (!headers) {
            headers = line as string[]
            line = []
            continue
          } else {
            let obj = model ? new model() : {}
            if (!model) {
              for (let i = 0, l = headers.length; i < l; i++) {
                const head = headers[i]
                obj[head] = line[i]
              }
            } else {
              for (let i = 0, l = headers.length; i < l; i++) {
                const head = headers[i]
                const deser = mpdes.get(head)
                if (deser)
                obj[deser.name] = deser.deserialize(line[i])
              }

              // should get its deserializers
            }
            // headers.reduce((acc, head, idx) => (acc[head] = model?.csv_helper[head]?.(line[idx]) ?? line[idx], acc), {} as any)
            console.log(obj, new Error)
            objs.push(obj)
          }
          line = []
        }
        continue
    }
  }

  return objs
}

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


export function GET(schema: string, url: string, opts: { exact_count?: boolean, model?: ModelMaker<any> } = { }) {
  return FETCH(url, {
    method: "GET",
    headers: {
      Accept: "text/csv",
      "Content-Type": "application/json",
      "Accept-Profile": schema,
      ...(opts.exact_count ? { Prefer: "count=exact" } : {}),
    },
    credentials: "include"
  }).then(async res => {
    const result = await uncsv(res, opts.model)
    const head = res.headers.get("Content-Range")
    if (opts.exact_count && head) {
      const [strbegin, strtotal] = head.split("/")
      const total = parseInt(strtotal)
      const [strfirst, strlast] = strbegin.split("-")
      const first = parseInt(strfirst)
      const last = parseInt(strlast)
      const pagecount = total / (first - last + 1)
      result[sym_count] = {total, first, last, pagecount}
    } else {
      result[sym_count] = {total: NaN, first: NaN, last: NaN, pagecount: NaN}
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



export async function POST(schema: string, url: string, body: any = {}, opts: { model?: ModelMaker<any> } = {}): Promise<any> {
  return FETCH(url, {
    method: "POST",
    headers: {
      Accept: "text/csv",
      "Content-Type": "application/json",
      "Accept-Profile": schema,
    },
    credentials: "include",
    body: body
  }).then(res => {
    return uncsv(res, opts.model)
  })
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
    const res = await GET(this.schema, this.url + supl, { ...opts, model: this })
    const res_t = Deserialize(res, this)
    if (opts.exact_count && res[sym_count]) res_t[sym_count] = res[sym_count]
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
