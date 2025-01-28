
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
    body: typeof body !== "string" ? JSON.stringify(body) : body
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

  label?: string
  comment?: string

  is_array?: boolean
  nullable?: boolean
  default_xp?: string
  pk?: boolean
}


export interface PgtsMeta {
  url: string
  schema: string
  pk_fields: string[]
  roles?: Roles
  rels: {[name: string]: {name: string, model: () => ModelMaker<any>, is_array: true | false}}
  columns: string[]
  computed_columns: string[]
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

/**

  s.Select("field1", "field2") -> pas de pk, donc pas d'objet direct ?
  s.Select("**") -- avec les champs computés
  s.Select("*", "pouet", "pouet2")
  s.Select().as("instance")
  s
    .$managers.Select("field1")
    .$managers.Select("**")
    .$managers(s =>
      s.Select("**")
      .as("managers")
      .$username(s => s.as("rel_user"))
    )
  .query()
*/

export function rol(name: string, perms: string): Roles {
  return new Roles().rol(name, perms)
}


export type ValidColumnBase<MT extends ModelMaker<any>> = MT["meta"]["columns"][number] | MT["meta"]["computed_columns"][number]

export type NamedColumnRef<MT extends ModelMaker<any>> = ValidColumnBase<MT> | `${ValidColumnBase<MT>}${"->" | "->>"}${string}`
export type OrderColumnRef<MT extends ModelMaker<any>> = NamedColumnRef<MT> | `${NamedColumnRef<MT>}.${"desc" | "asc"}`
export type ValidColumnRef<MT extends ModelMaker<any>> = NamedColumnRef<MT> | "*" | "**"


export class QueryBuilder {
  constructor() { }
  select: string[] = []
  where: string[] = []
  order: string[] = []
  limit: number | null = null
  offset: number | null = null
}

export class Where<MT extends ModelMaker<any>> {
  constructor(public builder: SelectBuilderBase<MT, any>) { }

  protected _op = "and"
  protected _subwheres: Where<MT>[] = []

  get not() {
    return this
  }
}

export interface Where<MT extends ModelMaker<any>> {
  eq(field: NamedColumnRef<MT>, value: any): this
  neq(field: NamedColumnRef<MT>, value: any): this
  gt(field: NamedColumnRef<MT>, value: any): this
  gte(field: NamedColumnRef<MT>, value: any): this
  lt(field: NamedColumnRef<MT>, value: any): this
  lte(field: NamedColumnRef<MT>, value: any): this
  like(field: NamedColumnRef<MT>, value: any): this
  ilike(field: NamedColumnRef<MT>, value: any): this
  match(field: NamedColumnRef<MT>, value: any): this
  imatch(field: NamedColumnRef<MT>, value: any): this
  in(field: NamedColumnRef<MT>, value: any): this
  is(field: NamedColumnRef<MT>, value: any): this
  isdistinct(field: NamedColumnRef<MT>, value: any): this
  fts(field: NamedColumnRef<MT>, value: any, lang?: string): this
  plfts(field: NamedColumnRef<MT>, value: any, lang?: string): this
  phfts(field: NamedColumnRef<MT>, value: any, lang?: string): this
  wfts(field: NamedColumnRef<MT>, value: any, lang?: string): this
}

export const binary_ops = ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "match", "imatch", "in", "is", "isdistinct", "is"]
export const unary_ops = ["not"]
export const fts_ops = ["fts", "plfts", "phfts", "wfts"]
// eq(any)
// (all)
//curl -g "http://localhost:3000/people?last_name=like(any).{O*,P*}"


export class SelectBuilderBase<MT extends ModelMaker<any>, Result = {obj: InstanceType<MT>}> {
  constructor(
    public readonly builder: MT,
    /** base_prop represents the property that we will try to deserialize into */
    public base_prop: string = "obj",
    public path: string[] = [],
    public is_base = false,
  ) { }

  fields = ["*"]
  subbuilders: SelectBuilderBase<any>[] = []

  _inner = false

  /**
   * Select all columns, with computed columns as well
   */
  selectAll() {
    this.fields = [...this.builder.meta.columns, ...this.builder.meta.computed_columns]
    return this
  }

  columns(...columns: ValidColumnRef<MT>[]) {
    this.fields = columns.flatMap(c =>
      c === "**" ? [...this.builder.meta.columns, ...this.builder.meta.computed_columns]
      : c
    )
    return this
  }

  where(where: (w: Where<MT>) => any) {
    const w = new Where<MT>(this)
    where(w)
    return this
  }

  async query(): Promise<Result[]> {
    return null!
  }

  get inner(): this {
    this._inner = true
    return this as any
  }

  collect(): string {
    for (const sub of this.subbuilders) {
      sub.collect()
    }
    return ""
  }

  deserialize(res: any): InstanceType<MT> {
    return null!
  }
}


export type Selected<S> = S extends SelectBuilderBase<infer MT, infer Result> ? Result : never

export type SelectBuilder<MT extends ModelMaker<any>, Result> = SelectBuilderBase<MT, Result> & {
  [K in keyof MT["meta"]["rels"]]:
    | (<MT2 = {obj: InstanceType<ReturnType<MT["meta"]["rels"][K]["model"]>>}>(
      fn?: (m: SelectBuilder<ReturnType<MT["meta"]["rels"][K]["model"]>, {obj: InstanceType<ReturnType<MT["meta"]["rels"][K]["model"]>>}>) => SelectBuilder<ReturnType<MT["meta"]["rels"][K]["model"]>, MT2>) =>
      SelectBuilder<MT, Result & {[k in K]: true extends MT["meta"]["rels"][K]["is_array"] ? MT2[] : MT2}>)

}


// export type SelectBuilder<MT extends ModelMaker<any>> = {
//   [K in keyof MT["meta"]["rels"]]: SelectBuilder<ReturnType<MT["meta"]["rels"][K]["model"]>>
// } & {
//   fields(...columns: ValidColumnRef<MT>[]): SelectBuilder<MT>
//   get inner(): SelectBuilder<MT>
//   __collect(): string
// }



export abstract class Model {

  [s.sym_on_deserialized]() {
    const pk = this.__pk
    if (pk != null) {
      this.__old_pk = pk
    }
  }

  static meta: PgtsMeta
  get __meta(): PgtsMeta { return (this.constructor as any).meta }

  get __model() { return this.constructor as new() => this }
  get __pk(): {[name: string]: any} | undefined { return undefined }
  __old_pk: {[name: string]: any} | undefined

  resetPk() {
    this.__old_pk = undefined
  }

  static async select<MT extends ModelMaker<any>, Result>(this: MT, select: (s: SelectBuilder<MT, {obj: InstanceType<MT>}>) => Result): Promise<Selected<Result>[]> {
    const builder = new SelectBuilderBase<MT, {obj: InstanceType<MT>}>(this, "obj", [], true)
    select(builder as any)
    return null!
  }

  static async get<T extends Model, MT extends ModelMaker<T>>(this: MT, supl: string = "", opts: { exact_count?: boolean } = {}): Promise<InstanceType<MT>[]> {
    // const ret = this as any as (new () => T)
    const meta = this.meta
    const res = await GET(meta.schema, meta.url + supl, { ...opts, })
    const res_t = s.deserialize(res, this)
    if (opts.exact_count && (res as any)[sym_count]) (res_t as any)[sym_count] = (res as any)[sym_count]
    return res_t as any
  }

  // static getSelectorObject<M extends Model>(this: ModelMaker<M>, alias: string = ""): SelectBuilder<ModelMaker<M>> {
  //   const meta = this.meta
  //   const more: (() => string)[] = []
  //   const deserializers: ((res: any) => any)[] = []
  //   let fields: string[] = ["*"]
  //   const res = {
  //     fields(...columns: string[]): any {
  //       fields = columns
  //       return res
  //     },
  //     get inner() {
  //       (res as any)._inner = "!inner"
  //       return res
  //     },
  //     __collect() {
  //       return [...fields, ...more.map(f => f())].join(",")
  //     },
  //     __deserializers() {
  //       return deserializers
  //     }
  //   }

  //   for (const col of [...meta.columns, ...meta.computed_columns]) {
  //     Object.defineProperty(res, col, {
  //       get() {
  //         return res
  //       }
  //     })
  //     // fields.push(col)
  //   }

  //   for (const [key, value] of Object.entries(meta.rels)) {
  //     let _resolved_selector: SelectBuilder<any> & { _inner?: string } | null = null
  //     Object.defineProperty(res, key, {
  //       get() {
  //         if (!_resolved_selector) {
  //           const mod = value.model()
  //           _resolved_selector = mod.getSelectorObject(value.name)
  //           more.push(() => {
  //             return `${value.name}${(_resolved_selector!._inner ?? "")}(${_resolved_selector!.__collect()})`
  //           })
  //           deserializers.push((res: any) => {
  //             return s.deserialize(res[key], mod)
  //           })
  //         }
  //         return _resolved_selector
  //       },
  //       set(columns: string[]) {
  //         // return this.getWith(key, columns)
  //       }
  //     })
  //   }
  //   return res as any
  // }

  // static async select<T extends Model, MT extends ModelMaker<T>>(this: MT, select: (s: SelectBuilder<MT>) => any, supl?: string): Promise<InstanceType<MT>[]> {
  //   const meta = this.meta
  //   const r = this.getSelectorObject()
  //   select(r as any)
  //   const q = r.__collect()
  //   // console.log(q)
  //   const res = await GET(meta.schema, `${meta.url}?select=${q}` + (supl ? "&" + supl : ""))
  //   const res_t = s.deserialize(res, this)
  //   // if (opts.exact_count && (res as any)[sym_count]) (res_t as any)[sym_count] = (res as any)[sym_count]
  //   return res_t as any
  // }

  static async remove<T extends Model, MT extends ModelMaker<T>>(this: MT, supl: string) {
    const meta = this.meta
    if (!supl)
      throw new Error("suppl cannot be empty")
    if (supl[0] !== "?") supl = "?" + supl
    const res = await DELETE(meta.schema, meta.url + supl)
    return res
  }

  static async saveMany<T extends Model, MT extends ModelMaker<T>>(this: MT, models: T[]) {
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
    const val = s.deserialize(defs, this)
    delete val.__old_pk
    console.log(val)
    return await val.save()
  }

  static create<T extends Model>(this: ModelMaker<T>, defs: any) {
    return s.deserialize(defs, this)
  }
}
