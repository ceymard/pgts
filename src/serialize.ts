export const sym_serializer = Symbol("serializer")

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonObject
  | JsonValue[]

export type JsonObject = {[name: string]: JsonValue}


interface Ctor<T = unknown> {
  new(): T;
  [sym_serializer]: Serializer<T>;
}


export class Action<T = unknown> {

  get internal_key(): symbol | string | null { return null }

  clone(): this {
    const clone = Object.create(
      Object.getPrototypeOf(this),
      Object.getOwnPropertyDescriptors(this)
    )
    return clone
  }

  get decorator(): ((target: any, prop?: string) => void) & this {
    const res = (target: any, prop?: string | symbol) => {
      this.decorate(target, prop)
    }
    Object.setPrototypeOf(res, this)
    return res as any // Yeah, we cheat
  }

  deserialize(instance: T, json: JsonObject) { }
  serialize(instance: T, json: JsonObject) { }

  decorate(target: any, prop?: string | symbol) {
    // when decorating a class, we get its prototype, so we need to check
    // its constructor
    const ser = Serializer.get(target.prototype, true)
    ser.addAction(this)
  }
}

export type OnDeserializedFn<T> = (instance: T, json: JsonObject) => unknown

export class ActionOnDeserialize<T> extends Action<T> {
  constructor(public _on_deserialize: OnDeserializedFn<T>) {
    super()
  }
}

export function on_deserialize<T>(fn: OnDeserializedFn<T>) {
  return new ActionOnDeserialize(fn).decorator
}

export type PropSerializerFn<F = unknown, T = unknown> = (v: F, result: JsonObject, instance: T) => JsonValue
export type PropDeserializerFn<F = unknown, T = unknown> = (value: JsonValue, instance: T, source_object: JsonObject) => F


export class PropAction<F = unknown, T = unknown> extends Action<T> {
  key!: string | symbol
  serializeTo: string | null = null
  deserializeFrom: string | null = null
  default_value?: F

  constructor(
    public serializer?: PropSerializerFn<F, T>,
    public deserializer?: PropDeserializerFn<F, T>,
  ) {
    super()
  }

  get internal_key() { return this.key }

  property(key: string | symbol) {
    const clone = this.clone()
    clone.key = key
    if (typeof key === "string") {
      if (!clone.serializeTo) clone.serializeTo = key
      if (!clone.deserializeFrom) clone.deserializeFrom = key
    }
    return clone
  }

  to(key: string | null) {
    this.serializeTo = key
    return this.decorator
  }

  from(key: string | null) {
    this.deserializeFrom = key
    return this.decorator
  }

  deserialize(instance: T, json: JsonObject) {

  }

  serialize(instance: T, json: JsonObject) {

  }

  /** This method is invoked by the proxies */
  addTo(c: Ctor<T>, key: string | symbol) {
    const clone = this.property(key)
    const ser = Serializer.get(c, true)
    ser.addAction(clone)
  }

  /** */
  decorate(target: any, prop: string | symbol): void {
    this.addTo(target, prop)
  }

}


/**
 *
 */
export class Serializer<T extends unknown = unknown> {

  constructor(public model: Ctor<T>) {

  }

  static get<T>(ctor: Function | {new(...a: any[]): T}, create = false): Serializer<T> {
    let res = (ctor as Ctor<T>)[sym_serializer]
    if (res == null) {
      if (!create) throw new Error("there is no known serializer for this object")
      res = new Serializer(ctor as Ctor<T>)

      const extendparent = (proto: Object) => {
        if (proto == null) return
        extendparent(Object.getPrototypeOf(proto))
        if (proto.hasOwnProperty(sym_serializer)) {
          for (let a of (proto as Ctor)[sym_serializer].actions) {
            res.addAction(a)
          }
        }
      }
      extendparent(Object.getPrototypeOf(ctor))

      Object.defineProperty(ctor, sym_serializer, {
        value: res,
        enumerable: false,
        writable: false,
      })
      return res
    }
    return res
  }

  static getFor<T>(obj: T | {new(...a: any[]): T | T[]}) {

  }

  /** since actions have internal keys, the Map is used to override actions */
  action_map = new Map<string | symbol, number>()
  /** the array is maintained separately */
  actions: Action[] = []

  addAction(action: Action) {
    const intkey = action.internal_key
    if (intkey != null) {
      let idx = this.action_map.get(intkey)
      if (idx) {
        this.actions[idx] = action
      } else {
        idx = this.actions.length
        this.actions.push(action)
        this.action_map.set(intkey, idx)
      }
    } else {
      this.actions.push(action)
    }
  }

  // is it needed ??
  removeAction(key: string | symbol) {

  }

  serialize(orig: T, res: JsonObject = {}): JsonObject {
    return res
  }

  deserialize(orig: JsonObject, into: T | null = null): T {

    // Once deserialized, execute the post deserialize hooks
  }

}


/////////////////////////////////////////////////////////////////////////////////////////////


/**
 * Deserialize a value coming from another source into either a brand new object if a constructor (or class object) is given, or an existing object if it is provided.
 *
 * `json` and `kls` must have the same length if they are both arrays.
 *
 * @param json Json value that comes from an external source
 * @param kls The class on which we have defined a serializer or an instance in which to deserialize the contents of the json object.
 */
export function deserialize<T>(json: JsonValue, kls: T | {new() : T}): T {

}


/**
 * Serialize
 * @param instance the object to serialize
 * @returns null if the object was null, a json object or a json array
 */
export function serialize<T extends any[]>(instance: T): JsonValue[]
export function serialize<T>(instance: T): JsonObject
export function serialize<T>(instance: T): JsonValue {
  if (instance == null) return null
  if (Array.isArray(instance)) {
    const ser = Serializer.get(instance[0].constructor)
    const res = new Array(instance.length)
    for (let i = 0, l = res.length; i < l; i++) {
      res[i] = ser.serialize(instance[i])
    }
    return res
  } else {
    const ser = Serializer.get(instance.constructor)
    return ser.serialize(instance)
  }
}


////////////////////////////////////////////////////////////////////////////////////////////
////// Basic Actions

function FieldSer<F = unknown, T = unknown>(
  ser: PropSerializerFn<F, T>,
  deser: PropDeserializerFn<F, T>,
) {
  return new PropAction<F, T>(ser, deser).decorator
}

export const str = FieldSer<string>(function to_str(s) { return String(s) }, function str_from_str(s) { return String(s) })
export const num = FieldSer<number>(n => Number(n), n => Number(n))
export const bool = FieldSer<boolean>(b => !!b, b => !!b)
export const json = FieldSer<JsonValue>(j => j, j => j)

function _pad(v: number) { return v < 10 ? "0" + v : "" + v }

/**
 * A serializer for date that returns an ISO date understood by most databases, but with its local timezone offset instead of UTC like toJSON() returns.
 */
export const date = FieldSer<Date>(
  function date_with_tz_to_json(d) {
    if (d == null) return null
    const tz_offset = d.getTimezoneOffset()
    const tz_sign = tz_offset > 0 ? '-' : '+'
    const tz_hours = _pad(Math.abs(Math.floor(tz_offset / 60)))
    const tz_minutes = _pad(Math.abs(tz_offset) % 60)
    const tz_string = `${tz_sign}${tz_hours}:${tz_minutes}`
    const dt = `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}T${_pad(d.getHours())}:${_pad(d.getMinutes())}:${_pad(d.getSeconds())}`

    return `${dt}${tz_string}`
  },
  function date_with_tz_from_json(d) { return new Date(d as any) }
)

export const date_utc = FieldSer<Date>(
  function date_to_utc(d) { return d.toJSON() },
  function date_from_utc(d) { return new Date(d as any) }
)

export const date_ms = FieldSer<Date>(
  function date_to_ms(d) { return d.valueOf() },
  function date_from_ms(d) { return new Date(d as any) }
)

export const date_seconds = FieldSer<Date>(
  function date_to_seconds(d) { return d.valueOf() / 1000 },
  function date_from_seconds(d) { return new Date(d as number * 1000) }
)

export const alias = function (fn: () => {new(...a:any[]): any}) {
  return FieldSer(
    o => serialize(o),
    o => deserialize(o, fn()),
  )
}

@on_deserialize(inst => {
  console.log(inst)
})
class Test {
  @str property!: string
}

class Test2 extends Test { }

import * as util from "util"
console.log(util.inspect(Test2.prototype, true, null, true))
