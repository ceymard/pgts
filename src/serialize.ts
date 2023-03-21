import * as util from "util"

export const sym_serializer = Symbol("serializer")

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonObject
  | JsonValue[]

export type JsonObject = {[name: string]: JsonValue}

declare global {
  interface Function {
    [sym_serializer]?: Serializer
  }
}

interface Ctor<T = unknown> {
  new(): T;
  [sym_serializer]: Serializer<T>;
}


export class Action<T = unknown> {

  get internal_key(): symbol | string | null { return null }

  /** return the Action instance, not the decorator function */
  protected get real_this() {
    // clone() can be called from the context of a decorator function, so we unbox it here to make sure we do have the Action.
    if (typeof this === "function") return Object.getPrototypeOf(this)
    return this
  }

  /** Clone shallow copies the Action */
  clone(): this {
    let _this = this.real_this
    const clone = Object.create(
      Object.getPrototypeOf(_this),
      Object.getOwnPropertyDescriptors(_this)
    )
    return clone
  }

  /**
   * "transform" the action into a decorator function which is achieved by switching the prototype of said function to the Action object.
  */
  get decorator(): ((target: any, prop?: string) => void) & this {
    const res = (target: any, prop?: string | symbol) => {
      this.decorate(target, prop)
    }
    Object.setPrototypeOf(res, this)
    Object.assign(res, Function.prototype) // keep the Function methods
    return res as any // Yeah, we cheat
  }

  deserialize(instance: T, json: JsonObject) { }
  serialize(instance: T, json: JsonObject) { }

  protected decorate(target: any, prop?: string | symbol) {
    // when decorating a class, we get its prototype, so we need to check
    // its constructor
    const ser = Serializer.get(target, true)
    ser.addAction(this)
  }
}

export type OnDeserializedFn<T> = (instance: T, json: JsonObject) => unknown

export class ActionOnDeserialize<T> extends Action<T> {
  constructor(public _on_deserialize: OnDeserializedFn<T>) {
    super()
  }

  deserialize(instance: T, json: JsonObject): void {
    this._on_deserialize(instance, json)
  }
}

export function on_deserialize<T>(fn: OnDeserializedFn<T>) {
  return new ActionOnDeserialize(fn).decorator
}

export type PropSerializerFn<F = unknown, T = unknown> = (v: F, result: JsonObject, instance: T) => unknown
export type PropDeserializerFn<F = unknown, T = unknown> = (value: JsonValue, instance: T, source_object: JsonObject) => F


export class PropAction<F = unknown, T = unknown> extends Action<T> {
  prop!: string | symbol
  _serialize_to!: string | symbol
  _deserialize_from!: string | symbol
  private _ignore_null = false

  constructor(
    public _serializer?: PropSerializerFn<F, T>,
    public _deserializer?: PropDeserializerFn<F, T>,
  ) {
    super()
  }

  get internal_key() { return this.prop }

  property(key: string | symbol) {
    const clone = this.clone()
    clone.prop = key
    if (!clone._serialize_to) clone._serialize_to = key as string
    if (!clone._deserialize_from) clone._deserialize_from = key as string
    return clone
  }

  /** Make this action read-only by removing the serializer part. */
  get RO() {
    const cl = this.clone()
    cl._serializer = undefined
    return cl.decorator
  }

  /** Make this action write-only by removing the deserializer part. */
  get WO() {
    const cl = this.clone()
    cl._deserializer = undefined
    return cl.decorator
  }

  /** Change the serialized field name */
  to_field(key: string | symbol) {
    const clone = this.clone()
    clone._serialize_to = key
    return clone.decorator
  }

  /** Read from another field name */
  from_field(key: string | symbol) {
    const clone = this.clone()
    clone._deserialize_from = key
    return clone.decorator
  }

  /** This method is invoked by the proxies */
  addTo(c: Ctor<T>, key: string | symbol) {
    const clone = this.property(key)
    const ser = Serializer.get(c, true)
    ser.addAction(clone)
  }

  /** internal implementation */
  protected decorate(target: any, prop: string | symbol): void {
    this.addTo(target.constructor, prop)
  }

  /** internal. */
  deserialize(instance: T, source: JsonObject) {
    if (this._deserializer == null) return

    // FIXME : should check for existence with hasOwnProperty
    let oval = (source as any)?.[this._deserialize_from]
    if (oval == null) {
      const curval = (instance as any)?.[this.prop]
      // There was no value in the original object
      if (curval == null && !this._ignore_null) {
        (instance as any)[this.prop] = null
      }
    } else {
      // There was a value, we're now going to deserialize it
      (instance as any)[this.prop] = this._deserializer(oval, instance, source)
    }
  }

  serialize(instance: T, json: JsonObject) {
    if (this._serializer == null) return

    // FIXME : should check for existence with hasOwnProperty
    let oval = (instance as any)?.[this.prop]
    if (oval == null) {
      (json as any)[this._serialize_to ?? this.prop] = null
    } else {
      (json as any)[this._serialize_to ?? this.prop] = this._serializer(oval, json, instance)
    }
  }

}


/**
 *
 */
export class Serializer<T extends unknown = unknown> {

  constructor(public model: {new(): T}) {

  }

  static get<T>(ctor: Function | {new(): T}, create = false): Serializer<T> {

    if (!ctor.hasOwnProperty(sym_serializer)) {
      if (!create) throw new Error("there is no known serializer for this object")
      const res = new Serializer<T>(ctor as {new(): T})

      // Check if there was a parent to this class
      const parent: Object = Object.getPrototypeOf(ctor)
      if (parent.hasOwnProperty(sym_serializer)) {
        const parent_ser: Serializer = (parent as any)[sym_serializer]
        if (parent_ser != null) {
          for (let a of parent_ser.actions) {
            res.addAction(a)
          }
        }
      }

      ;(ctor as Ctor)[sym_serializer] = res
      return res
    }
    return (ctor as Ctor)[sym_serializer] as Serializer<T>
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
    for (let i = 0, ac = this.actions, l = ac.length; i < l; i++) {
      ac[i].serialize(orig, res)
    }
    return res
  }

  deserialize(orig: JsonObject, into: T = new this.model()): T {
    for (let i = 0, ac = this.actions, l = ac.length; i < l; i++) {
      ac[i].deserialize(into, orig)
    }
    return into!
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
export function deserialize<T>(json: unknown[], kls: {new(): T} | T[]): T[]
export function deserialize<T>(json: unknown, kls: T): T
export function deserialize<T>(json: unknown, kls: T | {new() : T}): T | T[] {
  if (Array.isArray(json)) {
    if (Array.isArray(kls)) {
      // kls are a bunch of instances
      if (kls.length !== json.length) throw new Error(`both arrays need to be the same length`)
      for (let i = 0, l = kls.length; i < l; i++) {
        // For every member of both arrays, get the serializer for the given destination item and deserialize in place.
        const ser = Serializer.get(kls[i])
        ser.deserialize(json[i] as JsonObject, kls[i])
      }
      return kls
    } else {
      const ser = Serializer.get(kls as Function)
      const res = new Array(json.length)
      for (let i = 0, l = res.length; i < l; i++) {
        res[i] = ser.deserialize(json[i] as JsonObject)
      }
      return res as T[]
    }
  }

  const ser = Serializer.get<T>(kls as Function)
  return ser.deserialize(json as JsonObject)
}


/**
 * Serialize
 * @param instance the object to serialize
 * @returns null if the object was null, a json object or a json array
 */
export function serialize<T extends any[]>(instance: T): unknown[]
export function serialize<T>(instance: T): unknown
export function serialize<T>(instance: T): unknown {
  if (instance == null) return null
  if (Array.isArray(instance)) {
    if (instance.length === 0) return[]
    const res = new Array(instance.length)
    for (let i = 0, l = res.length; i < l; i++) {
      const ser = Serializer.get(instance[0].constructor)
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

function prop_action<F = unknown, T = unknown>(
  ser: PropSerializerFn<F, T>,
  deser: PropDeserializerFn<F, T>,
) {
  return new PropAction<F, T>(ser, deser).decorator
}

export const str = prop_action<string>(function ser_str(s) { return String(s) }, function deser_str(s) { return String(s) })
export const num = prop_action<number>(function ser_num(n) { return Number(n) }, function deser_num(n) { return Number(n) })
export const bool = prop_action<boolean>(function ser_bool(b) { return !!b }, function deser_bool(b) { return !!b })
export const as_is = prop_action<JsonValue>(function ser_as_is(j) { return j }, function deser_as_is(j) { return j })

function _pad(v: number) { return v < 10 ? "0" + v : "" + v }

/**
 * A serializer for date that returns an ISO date understood by most databases, but with its local timezone offset instead of UTC like toJSON() returns.
 */
export const date_tz = prop_action<Date>(
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

export const date_utc = prop_action<Date>(
  function date_to_utc(d) { return d.toJSON() },
  function date_from_utc(d) { return new Date(d as any) }
)

export const date_ms = prop_action<Date>(
  function date_to_ms(d) { return d.valueOf() },
  function date_from_ms(d) { return new Date(d as any) }
)

export const date_seconds = prop_action<Date>(
  function date_to_seconds(d) { return Math.floor(d.valueOf() / 1000) },
  function date_from_seconds(d) { return new Date(d as number * 1000) }
)

export const alias = function (fn: () => {new(...a:any[]): any}) {
  return prop_action(
    o => serialize<unknown>(o),
    o => deserialize(o, fn()),
  )
}

@on_deserialize(function do_stuff_with(inst) {
  console.log("just deserialized !", inst)
})
class Test {
  @str property: string = "zboub"
  @num numprop: number = 0
}

class Test2 extends Test {
  @bool.to_field("bool2") boolprop: boolean = false
}

class Test3 extends Test2 {
  @date_tz dt: Date = new Date()
  @date_ms dts: Date = new Date
  @date_seconds dtsec: Date = new Date
}

class Test4 extends Test3 {
  @bool boolprop: boolean = false
}

class Zboubi {
  @alias(() => Test3) test: Test3 = new Test3()
}

// const ser = Test3[sym_serializer]
const des = deserialize([{dt: "2021-04-01"}], Test3)
console.log(des)
const t = new Test3()
console.log(serialize(t))
console.log(serialize([new Test4]))

console.log(serialize(new Zboubi))
