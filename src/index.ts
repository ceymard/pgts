
import * as s from "@salesway/scotty"
export * as s from "@salesway/scotty"
export * from "./types"

export type Json = any
export type Jsonb = Json

export interface PgtsResult<MT extends ModelMaker<any>> {
  $: InstanceType<MT>
}

export type ModelMaker<T extends Model> =
  {new(...a: any): T} & Pick<typeof Model, keyof typeof Model>

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


function _date_to_iso(date: Date) {

  // Get the local date and time components
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const milliseconds = date.getMilliseconds().toString().padStart(3, '0');

  // Get the local timezone offset in minutes
  const timezoneOffset = date.getTimezoneOffset();

  // Convert the offset to hours and minutes
  const offsetHours = Math.abs(Math.floor(timezoneOffset / 60)).toString().padStart(2, '0');
  const offsetMinutes = Math.abs(timezoneOffset % 60).toString().padStart(2, '0');
  const offsetSign = timezoneOffset <= 0 ? '+' : '-';

  // Create the timezone offset string
  const timezoneOffsetString = `${offsetSign}${offsetHours}:${offsetMinutes}`;

  // Construct the ISO string with the local date and time
  const dateWithOffset = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${timezoneOffsetString}`;

  return dateWithOffset
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
    body: typeof body !== "string" ? JSON.stringify(body, function (key, val) {
      const v = this[key]
      if (v instanceof Date) {
        return _date_to_iso(v)
      }
      return val
    }) : body
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
  rels: {[name: string]: {
    name: string,
    model: () => ModelMaker<any>,
    nullable: boolean
    is_array: true | false,
    to_columns: string[],
    from_columns: string[],
  }}
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


export function rol(name: string, perms: string): Roles {
  return new Roles().rol(name, perms)
}


export type ValidColumnBase<MT extends ModelMaker<any>> = MT["meta"]["columns"][number] | MT["meta"]["computed_columns"][number]

export type NamedColumnRef<MT extends ModelMaker<any>> = ValidColumnBase<MT> | `${ValidColumnBase<MT>}${"->" | "->>"}${string}`
export type OrderColumnRef<MT extends ModelMaker<any>> = NamedColumnRef<MT> | `${NamedColumnRef<MT>}.${"desc" | "asc"}`
export type ValidColumnRef<MT extends ModelMaker<any>> = NamedColumnRef<MT> | "*" | "**"



// export class Where<MT extends ModelMaker<any>> {
//   constructor(public builder: SelectBuilder<MT, any>) { }

//   protected _op = "and"
//   protected _subwheres: Where<MT>[] = []

//   bin(field: NamedColumnRef<MT>, op: PostgrestBinaryOp, value: any): this
//   bin(field: NamedColumnRef<MT>, op: `${PostgrestBinaryOp}(${"any" | "all"})`, ...values: any[]): this
//   bin(
//     field: NamedColumnRef<MT>,
//     op: string,
//     ...value: any[]
//   ): this {
//     return this
//   }
// }



export type PGBinary<MT extends ModelMaker<any>> = [field: NamedColumnRef<MT>, op: PostgrestBinaryOp, value: any]
export type PGBinaryArray<MT extends ModelMaker<any>> = [field: NamedColumnRef<MT>, op: `${PostgrestBinaryOp}(${"any" | "all"})`, ...value: any[]]
export type PGOp<MT extends ModelMaker<any>> = PGBinary<MT> | PGBinaryArray<MT>

export type PgtsWhere<MT extends ModelMaker<any>> = PGOp<MT> | ["not", PgtsWhere<MT>] | ["and", ...PgtsWhere<MT>[]] | ["or", ...PgtsWhere<MT>[]]


export type PostgrestUnaryOp = "not"
export type PostgrestFtsOp = `fts(${string})` | `plfts(${string})` | `phfts(${string})` | `wfts(${string})`
export type PostgrestBinaryOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "match" | "imatch" | "in" | "is" | "isdistinct" | "is" | "cs" | "cd" | "ov" | "sl" | "sr" | "nxr" | "nxl" | "adj" | PostgrestFtsOp



export type ResultCreator<T extends {$: Model}> = {[K in keyof T]:
  T[K] extends { create(arg: infer c): any} ? c // generally the $ key which is a simple model
  : T[K] extends (infer C)[] ? C extends {$: Model} ? ResultCreator<C>[] : never // array of simple models
  : T[K] extends { $: Model } ? ResultCreator<T[K]> // array of models
  : never
}


export class SelectBuilder<MT extends ModelMaker<any>, Result extends {$: Model} = {$: InstanceType<MT>}> {
  constructor(
    public readonly model: MT,
    /** base_prop represents the property that we will try to deserialize into */
    public key: string,
    public fullname: string,
    public path: string[] = [],
  ) { }

  fields = ["*"]
  subbuilders: SelectBuilder<any>[] = []
  wheres: PgtsWhere<MT>[] = []
  _order: OrderColumnRef<MT>[] = []

  _inner = false

  /**
   * Select all columns, with computed columns as well
   */
  get all() {
    const res = this.clone()
    res.fields = ["*", ...this.model.meta.computed_columns]
    return res
  }

  create(arg: ResultCreator<Result>): Result {
    return arg as Result
  }

  clone(): this {
    const res = new SelectBuilder(this.model, this.key, this.fullname, this.path) as this
    res.subbuilders = this.subbuilders.map(sb => sb.clone())
    res.fields = [...this.fields]
    res.wheres = [...this.wheres]
    res._order = [...this._order]
    res._inner = this._inner
    return res
  }

  empty(): Result {
    const res = {$: this.model.create({})}
    for (const sub of this.subbuilders) {
      ;(res as any)[sub.key] = sub.empty()
    }
    return res as Result
  }

  orderBy(...columns: OrderColumnRef<MT>[]) {
    const res = this.clone()
    res._order.push(...columns)
    return res
  }

  omit(...columns: ValidColumnRef<MT>[]) {
    const res = this.clone()
    res.fields = res.model.meta.columns.filter(c => !columns.includes(c))
    return res
  }

  omitFromAll(...columns: ValidColumnRef<MT>[]) {
    const res = this.clone()
    res.fields = [...this.model.meta.columns, ...this.model.meta.computed_columns].filter(c => !columns.includes(c))
    return res
  }

  columns(...columns: ValidColumnRef<MT>[]) {
    const res = this.clone()
    res.fields = columns.flatMap(c =>
      c === "**" ? [...this.model.meta.columns, ...this.model.meta.computed_columns]
      : c
    )
    return res
  }

  where(...where: PgtsWhere<MT>[]): this {
    const res = this.clone()
    res.wheres.push(...where)
    return res
  }

  get inner(): this {
    this._inner = true
    return this as any
  }

  collectFields(): string {
    return [
      ...this.fields,
      ...this.subbuilders.map(sb => `${sb.fullname}(${sb.collectFields()})`)
    ].join(",")
  }

  collectOthers(): string[] {
    const prefix = this.path.length ? this.path.join(".") + "." : ""

    const _where = (where: PgtsWhere<MT>): string => {

      if (where[0] === "not") {
        return `${prefix}not.(${_where(where[1] as PgtsWhere<MT>)})`
      }
      if (where[0] === "and") {
        return `${prefix}and.(${where.slice(1).map(w => _where(w)).join(",")})`
      }
      if (where[0] === "or") {
        return `${prefix}or.(${where.slice(1).map(w => _where(w)).join(",")})`
      }
      const [field, op, value] = where
      return `${field}.${op}.${encodeURIComponent(value)}`
    }
    let wheres = this.wheres
    if (wheres.length === 1 && wheres[0][0] === "and") {
      wheres = wheres[0].slice(1)
    }
    return [
      ...(!this.wheres.length ? [] : [`${prefix}and=(${wheres.map(_where).join(",")})`]),
      // this.where,
      ...(this._order.length ? [`${prefix}order=${this._order.join(",")}`] : []),
      ...this.subbuilders.flatMap(sb => sb.collectOthers()),
    ]
  }

  rel<K extends RelKey<MT>, MT2 extends {$: RelInstance<MT, K>} = {$: RelInstance<MT, K>}>(
    key: K,
    select?: (s: SelectBuilder<Rel<MT, K>, {$: RelInstance<MT, K>}>) => SelectBuilder<Rel<MT, K>, MT2>
  ): SelectBuilder<MT, Result & {[k in K]: RelIsArray<MT, K, MT2>}> {
    const meta = (this.model.meta.rels as any)[key] as PgtsMeta["rels"][string]
    const res = this.clone()

    let sub = new SelectBuilder<Rel<MT, K>, {$: RelInstance<MT, K>}>(
      meta.model() as any,
      key as string,
      meta.name,
      [...this.path, key as string]
    )
    sub = select?.(sub) ?? sub as any
    res.subbuilders.push(sub)

    return res as any
  }

  deserialize(_row: any): Result {
    const $ = _row != null ? s.deserialize(_row, this.model) : null
    const res: any = {$}
    for (const sub of this.subbuilders) {
      const sub_item = _row[sub.key]
      res[sub.key] = Array.isArray(sub_item) ? sub_item.map(i => i != null ? sub.deserialize(i) : null) : sub_item != null ? sub.deserialize(sub_item) : null
    }
    return res
  }

  async fetch(): Promise<Result[]> {
    const meta = this.model.meta
    const q = ["select=" + this.collectFields(), ...this.collectOthers()]
    const res = await GET(meta.schema, meta.url + "?" + q.join("&")) as any[]
    const dres = res.map(r => this.deserialize(r))
    return dres
  }
}

export type RelIsArray<MT extends ModelMaker<any>, K extends RelKey<MT>, T> = true extends MT["meta"]["rels"][K]["is_array"] ? T[] : T

export type RelKey<MT extends ModelMaker<any>> = keyof MT["meta"]["rels"]
export type Rel<MT extends ModelMaker<any>, K extends keyof MT["meta"]["rels"]> = ReturnType<MT["meta"]["rels"][K]["model"]>
export type RelInstance<MT extends ModelMaker<any>, K extends keyof MT["meta"]["rels"]> = InstanceType<Rel<MT, K>>

export type Selected<S> = S extends SelectBuilder<infer MT, infer Result> ? Result : never


let __unknown_strkey_k = 0
let sym_unknown_strkey = Symbol("unknown_strkey")

export abstract class Model {

  [s.sym_on_deserialized]() {
    const pk = this.__pk
    if (pk != null) {
      this.__old_pk = pk
    }
  }

  static meta: PgtsMeta
  get __strkey_pk(): string {
    let p = (this as any)[sym_unknown_strkey]
    if (p == null) {
      p = "_k_" + __unknown_strkey_k++
      ;(this as any)[sym_unknown_strkey] = p
    }
    return p
  }

  get __meta(): PgtsMeta { return (this.constructor as any).meta }

  get __model() { return this.constructor as new() => this }
  get __pk(): {[name: string]: any} | undefined { return undefined }
  __old_pk: {[name: string]: any} | undefined

  resetPk() {
    this.__old_pk = undefined
  }

  static select<MT extends ModelMaker<any>, Result extends {$: InstanceType<MT>}>(this: MT, select: (s: SelectBuilder<MT, {$: InstanceType<MT>}>) => SelectBuilder<MT, Result>) {
    const builder = new SelectBuilder<MT, {$: InstanceType<MT>}>(this, "", "item", [])
    return select(builder)
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
    // const cst = this.__model
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

  create(defs: any): any { }

  static async createInDb(defs: any): Promise<any> {
    const val = s.deserialize(defs, this as any)
    delete val.__old_pk
    return await val.save()
  }

  static create(defs: any): any {
    return s.deserialize(defs, this as any)
  }
}
