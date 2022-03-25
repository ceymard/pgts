
import { autoserializeAs as aa, autoserialize as a, Deserialize, Serialize } from "cerialize"

/** !impl FILE_HEADER **/
// Add your imports here
/** !end impl **/

/**
 * WARNING
 * THIS FILE IS GENERATED BY THE pgts UTIL
 * ONLY EDIT CODE WHERE STATED
 * BEWARE THAT CODE MAY DISAPPEAR IF THE CORRESPONDING TABLE CHANGES ITS NAME
 */

export const HstoreSerializer = {
  Serialize(hstore: Map<string, string>) {
    const res: string[] = []
    for (const [key, obj] of hstore) {
      res.push(`${key} => ${obj}`)
    }
    return res.join(", ")
  },
  Deserialize(json: any) {
    const res = new Map<string, string>()
    for (const key in json) {
      res.set(key, json[key])
    }
    return res
  }
}

/**
 * Convert the dates to and from UTC time since postgres is generally using UTC internally.
 */
export const UTCDateSerializer = {
  Serialize(date: any): any {
    if (date == null) return null
    return new Date(date).toJSON()
  },
  Deserialize(date: any) {
    if (date instanceof Date) return date
    if (date == null) return null
    return new Date(date)
  }
}

export type Json = any
export type Jsonb = Json


export interface ModelMaker<T extends Model> {
  new (): T
  url: string
}


export function FETCH(input: RequestInfo, init?: RequestInit): Promise<Response> {
  /** !impl FETCH_PRELUDE **/
  // override here the way fetch should work globally
  return fetch(input, init).then(res => {
    if (res.status < 200 || res.status >= 400)
      return Promise.reject(res)
    return res
  })
  /** !end impl **/
}


export function GET(url: string) {
  return FETCH(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    credentials: "include"
  }).then(res => {
    return res.json()
  })
}

export function DELETE(url: string) {
  return FETCH(url, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    credentials: "include"
  }).then(res => {
    return res.text() as any
  })
}



export async function POST(url: string, body: any = {}): Promise<any> {
  return FETCH(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    credentials: "include",
    body: body
  }).then(res => {
    return res.json()
  })
}


export const Cons = Symbol("constructor")


export abstract class Model {
  abstract get [Cons](): typeof Model
  static url = ""
  static pk: string[] = []
  oldpk!: any[]

  static async get<T extends Model>(this: ModelMaker<T>, supl: string = ""): Promise<T[]> {
    // const ret = this as any as (new () => T)
    const res = await GET(this.url + supl)
    return Deserialize(res, this)
  }

  static async remove<T extends Model>(this: ModelMaker<T>, supl: string) {
    if (!supl)
      throw new Error("suppl cannot be empty")
    if (supl[0] !== "?") supl = "?" + supl
    const res = await DELETE(this.url + supl)
    return res
  }

  static async saveMany<T extends Model>(this: ModelMaker<T>, models: T[]) {
    if (!models.length) return []

    const heads = new Headers({
      Accept: "application/json",
      Prefer: "resolution=merge-duplicates",
      "Content-Type": "application/json"
    })
    heads.append("Prefer", "return=representation")

    const res = await FETCH(this.url, {
      method: "POST",
      headers: heads,
      credentials: "include",
      body: JSON.stringify(models.map(m => Serialize(m, this)))
    })

    return Deserialize((await res.json()), this) as T[]
  }

  protected async doSave(url: string, method: string): Promise<this> {
    const heads = new Headers({
      Accept: "application/json",
      Prefer: "resolution=merge-duplicates",
      "Content-Type": "application/json"
    })
    heads.append("Prefer", "return=representation")
    const res = await FETCH(url, {
      method: method,
      headers: heads,
      credentials: "include",
      body: JSON.stringify(Serialize(this, this[Cons]))
    })

    const payload = (await res.json())[0]
    const n = Deserialize(payload, this[Cons])
    return n

  }

  /**
   * Save upserts the record.
   */
  async save() {
    if (this.oldpk)
      return this.update()
    return this.doSave(this[Cons].url, "POST")
  }

  /**
   * Update just updates the record.
   */
  async update(...keys: (keyof this)[]): Promise<this> {
    const parts: string[] = []
    const cst = this[Cons]
    const pk = cst.pk
    if (!pk || pk.length === 0) {
      throw new Error("can't instance-update an item without primary key")
    }
    for (let i = 0; i < pk.length; i++) {
      parts.push(`${pk[i]}=eq.${this.oldpk[i]}`)
    }

    if (keys.length) {
      parts.push(`columns=${keys.join(",")}`)
    }

    return this.doSave(cst.url + (parts.length ? `?${parts.join("&")}` : ""), "PATCH").then(r => {
      this.oldpk = pk.map(k => (this as any)[k])
      return r
    })
  }

  async delete(): Promise<Response> {
    const cst = this[Cons]
    if (!cst.pk || cst.pk.length === 0) {
      throw new Error("can't instance-delete an item without primary key")
    }
    const parts: string[] = []
    for (const pk of cst.pk) {
      parts.push(`${pk}=eq.${(this as any)[pk]}`)
    }
    return FETCH(`${cst.url}?${parts.join("&")}`, {
      method: "DELETE",
      credentials: "include",
    })
  }

  /** !impl Model **/
  // Add methods to model here
  /** !end impl **/
}

