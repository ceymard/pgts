/**
 * WARNING
 * THIS FILE IS GENERATED BY THE pgts UTIL
 * ONLY EDIT CODE WHERE STATED
 * BEWARE THAT CODE MAY DISAPPEAR IF THE CORRESPONDING TABLE CHANGES ITS NAME
 */

export interface Json {
	[x: string]: string | number | boolean | Date | Json | JsonArray;
}

export interface JsonArray extends Array<string | number | boolean | Date | Json | JsonArray> { }


export interface ModelMaker<T extends Model> {
  new (): T
  url: string
}


export function GET(url: string) {
  /** !impl GET **/
  return fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    credentials: 'include'
  }).then(res => {
  	if (res.status < 200 || res.status >= 400)
  	  return Promise.reject(res)
  	return res.json()
  })
  /** !end impl **/
}


export async function POST(url: string, body: any = {}): Promise<any> {
  /** !impl POST **/
  return fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: body
  }).then(res => {
    if (res.status < 200 || res.status >= 400)
      return Promise.reject(res)
    return res.json()
  })
  /** !end impl **/
}

export class Model {
  static url = ''

  static async get<T extends Model>(this: ModelMaker<T>): Promise<T[]> {
    const ret = this as any as (new () => T)
    const res = await GET(this.url)
    const len = res.length
    const result = new Array(len) as T[]
    const pros = Object.getOwnPropertyNames(new ret()) as (keyof T)[]
    for (var i = 0; i < len; i++) {
      var json = res[i]
      var obj = new ret()
      for (var p of pros) {
        if (json[p] !== undefined) obj[p] = json[p]
      }
      result[i] = obj
    }
    return result
  }

  async save() {

  }

  /** !impl Model **/
  // Add methods to model here
  /** !end impl **/
}

