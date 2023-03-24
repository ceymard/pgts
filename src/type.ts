
// « Before PostgreSQL version 8.3, the name of a generated array type was always exactly the element type's name with one underscore character (_) prepended. (Type names were therefore restricted in length to one fewer character than other names.) While this is still usually the case, the array type name may vary from this in case of maximum-length names or collisions with user type names that begin with underscore. Writing code that depends on this convention is therefore deprecated. Instead, use pg_type.typarray to locate the array type associated with a given type. »

/*

(function (tbl) {
  const str = []
  for (let t of temp1.querySelectorAll("tbody td:first-child")) {
    const field = t.querySelector(".structfield").textContent.trim()
    const typ = t.querySelector(".type").textContent.trim()
    const evaled = typ.replace(/(float\d+|int\d+)/g, "number")
      .replace(/bool/g, "boolean")
      .replace(/\w+id|text|char/g, "string")
      + " // " + typ
    const cmt = t.querySelector("p:not(:first-child)").textContent
    const p = t.querySelector("p:first-child").cloneNode(true)
    while (p.querySelector("code:first-child")) { p.removeChild(p.firstChild) }
    str.push(`  /** ${cmt} *` + "/")
    str.push(`  ${field}: ${evaled}`)
  }

  console.log(str.join("\n"))
})(temp1)

*/

import { Client } from "pg"

export let c: Client

export async function connect(uri: string) {
  c = new Client(uri)
  await c.connect()
}

export async function end() {
  await c.end()
}

export type Oid = string

export const enum PgTypeKind {
  Composite = "c", // tables, ou user created
  Base = "b",
  Domain = "d",
  Enum = "e",
  Pseudo = "p",
  Range = "r",
}


/**
 * https://www.postgresql.org/docs/current/catalog-pg-type.html
 */
export interface PgType {
  oid: Oid
  typname: string
  typnamespace: string // really number
  typowner: string // really number
  typlen: number
  typbyval: boolean

  /* "c" for user created */
  typtype: PgTypeKind
  typcategory: string
  typispreferred: boolean

  /** @important Character that separates two values of this type when parsing array input. Note that the delimiter is associated with the array element data type, not the array data type. */
  typdelim: string

  /** @important If this is a composite type (typtype === Composite), then this column points to the pg_class entry that defines the corresponding table. (For a free-standing composite type, the pg_class entry doesn't really represent a table, but it is needed anyway for the type's pg_attribute entries to link to.) Zero for non-composite types. (references pg_class.oid) */
  typrelid: string // really number
  typelem: string

  /** If typarray is not zero then it identifies another row in pg_type, which is the “true” array type having this type as element (references pg_type.oid) */
  typarray: Oid

  /** Input conversion function (text format) */
  typinput: string
  typoutput: string
  typreceive: string
  typsend: string
  typmodin: string
  typmodout: string
  typanalyze: string
  typalign: string
  typstorage: string
  typnotnull: boolean
  typbasetype: string // num
  typtypmod: number
  typndims: number
  typcollation: string
  typdefaultbin: string | null
  typacl: null | string
}



/**
 * https://www.postgresql.org/docs/current/catalog-pg-attribute.html
 *
 * The catalog pg_attribute stores information about table columns. There will be exactly one pg_attribute row for every column in every table in the database. (There will also be attribute entries for indexes, and indeed all objects that have pg_class entries.)
 *
 * The term "attribute" is equivalent to "column" and is used for historical reasons.
 */
export interface PgAttribute {
  /** The table this column belongs to (references pg_class.oid) */
  attrelid: Oid
  attname: string
  atttypid: string
  attstattarget: number
  attlen: number
  attnum: number
  attndims: number
  attcacheoff: number
  atttypmod: number
  attbyval: boolean
  attstorage: string
  attalign: string
  attnotnull: boolean
  atthasdef: boolean
  atthasmissing: boolean
  attidentify: null
  attisdropped: boolean
  attislocal: boolean
  attinhcount: number
  attcollation: number
  attacl: null
  attoptions: null
}

export interface PgAttrdef {
  oid: Oid
  /** references pg_class.oid */
  adrelid: Oid
  /** references pg_attribute.attnum */
  adnum: number
  /** pg_node_tree */
  adbin: string
}

/**
 * https://www.postgresql.org/docs/current/catalog-pg-description.html
 */
export interface PgDescription {
  /**
   * The OID of the object this description pertains to
   * (references any OID column)
   */
  objoid: Oid

  /**
   * The OID of the system catalog this object appears in
   * (references pg_class.oid)
   */
  classoid: Oid

  /** For a comment on a table column, this is the column number (the objoid and classoid refer to the table itself). For all other object types, this column is zero. */
  objsubid: number

  /** Arbitrary text that serves as the description of this object */
  description: string
}


export const enum PgClassRelKind {
  Table = "r",
  Index = "i",
  Sequence = "S",
  ToastTable = "t",
  View = "v",
  MaterializedView = "m",
  CompositeType = "c",
  ForeignTable = "f",
  PartitionedTable = "p",
  PartitionedIndex = "I",
}

/**
 * https://www.postgresql.org/docs/current/catalog-pg-class.html
 *
 * The catalog pg_class catalogs tables and most everything else that has columns or is otherwise similar to a table. This includes indexes (but see also pg_index), sequences (but see also pg_sequence), views, materialized views, composite types, and TOAST tables; see relkind. Below, when we mean all of these kinds of objects we speak of “relations”. Not all columns are meaningful for all relation types.
*/
export interface PgClass {
  /** Row identifier */
  oid: string // oid
  /** Name of the table, index, view, etc. */
  relname: string // name
  /** The OID of the namespace that contains this relation */
  relnamespace: string // oid
  /** The OID of the data type that corresponds to this table's row type, if any; zero for indexes, sequences, and toast tables, which have no pg_type entry */
  reltype: string // oid
  /** For typed tables, the OID of the underlying composite type; zero for all other relations */
  reloftype: string // oid
  /** Owner of the relation */
  relowner: string // oid
  /** If this is a table or an index, the access method used (heap, B-tree, hash, etc.); otherwise zero (zero occurs for sequences, as well as relations without storage, such as views) */
  relam: string // oid
  /** Name of the on-disk file of this relation; zero means this is a “mapped” relation whose disk file name is determined by low-level state */
  relfilenode: string // oid
  /** The tablespace in which this relation is stored. If zero, the database's default tablespace is implied. (Not meaningful if the relation has no on-disk file.) */
  reltablespace: string // oid
  /** Size of the on-disk representation of this table in pages (of size BLCKSZ). This is only an estimate used by the planner. It is updated by VACUUM, ANALYZE, and a few DDL commands such as CREATE INDEX. */
  relpages: number // int4
  /** Number of live rows in the table. This is only an estimate used by the planner. It is updated by VACUUM, ANALYZE, and a few DDL commands such as CREATE INDEX. If the table has never yet been vacuumed or analyzed, reltuples contains -1 indicating that the row count is unknown. */
  reltuples: number // float4
  /** Number of pages that are marked all-visible in the table's visibility map. This is only an estimate used by the planner. It is updated by VACUUM, ANALYZE, and a few DDL commands such as CREATE INDEX. */
  relallvisible: number // int4
  /** OID of the TOAST table associated with this table, zero if none. The TOAST table stores large attributes “out of line” in a secondary table. */
  reltoastrelid: string // oid
  /** True if this is a table and it has (or recently had) any indexes */
  relhasindex: boolean // bool
  /** True if this table is shared across all databases in the cluster. Only certain system catalogs (such as pg_database) are shared. */
  relisshared: boolean // bool
  /** p = permanent table/sequence, u = unlogged table/sequence, t = temporary table/sequence */
  relpersistence: string // char
  /** r = ordinary table, i = index, S = sequence, t = TOAST table, v = view, m = materialized view, c = composite type, f = foreign table, p = partitioned table, I = partitioned index */
  relkind: PgClassRelKind // char
  /** Number of user columns in the relation (system columns not counted). There must be this many corresponding entries in pg_attribute. See also pg_attribute.attnum. */
  relnatts: number // int2
  /** Number of CHECK constraints on the table; see pg_constraint catalog */
  relchecks: number // int2
  /** True if table has (or once had) rules; see pg_rewrite catalog */
  relhasrules: boolean // bool
  /** True if table has (or once had) triggers; see pg_trigger catalog */
  relhastriggers: boolean // bool
  /** True if table or index has (or once had) any inheritance children or partitions */
  relhassubclass: boolean // bool
  /** True if table has row-level security enabled; see pg_policy catalog */
  relrowsecurity: boolean // bool
  /** True if row-level security (when enabled) will also apply to table owner; see pg_policy catalog */
  relforcerowsecurity: boolean // bool
  /** True if relation is populated (this is true for all relations other than some materialized views) */
  relispopulated: boolean // bool
  /** Columns used to form “replica identity” for rows: d = default (primary key, if any), n = nothing, f = all columns, i = index with indisreplident set (same as nothing if the index used has been dropped) */
  relreplident: string // char
  /** True if table or index is a partition */
  relispartition: boolean // bool
  /** For new relations being written during a DDL operation that requires a table rewrite, this contains the OID of the original relation; otherwise zero. That state is only visible internally; this field should never contain anything other than zero for a user-visible relation. */
  relrewrite: string // oid
  /** All transaction IDs before this one have been replaced with a permanent (“frozen”) transaction ID in this table. This is used to track whether the table needs to be vacuumed in order to prevent transaction ID wraparound or to allow pg_xact to be shrunk. Zero (InvalidTransactionId) if the relation is not a table. */
  relfrozenxid: string // xid
  /** All multixact IDs before this one have been replaced by a transaction ID in this table. This is used to track whether the table needs to be vacuumed in order to prevent multixact ID wraparound or to allow pg_multixact to be shrunk. Zero (InvalidMultiXactId) if the relation is not a table. */
  relminmxid: string // xid
  /** Access privileges; see Section 5.7 for details */
  relacl: any[] // aclitem[]
  /** Access-method-specific options, as “keyword=value” strings */
  reloptions: string[] // text[]
  /** If table is a partition (see relispartition), internal representation of the partition bound */
  relpartbound: any // pg_node_tree
}


/**
 *
 */
export interface PgProc {
  /** Row identifier */
  oid: string // oid
  /** Name of the function */
  proname: string // name
  /** The OID of the namespace that contains this function */
  pronamespace: string // oid
  /** Owner of the function */
  proowner: string // oid
  /** Implementation language or call interface of this function */
  prolang: string // oid
  /** Estimated execution cost (in units of cpu_operator_cost); if proretset, this is cost per row returned */
  procost: number // float4
  /** Estimated number of result rows (zero if not proretset) */
  prorows: number // float4
  /** Data type of the variadic array parameter's elements, or zero if the function does not have a variadic parameter */
  provariadic: string // oid
  /** Planner support function for this function (see Section 38.11), or zero if none */
  prosupport: string // regproc
  /** f for a normal function, p for a procedure, a for an aggregate function, or w for a window function */
  prokind: string // char
  /** Function is a security definer (i.e., a “setuid” function) */
  prosecdef: boolean // bool
  /** The function has no side effects. No information about the arguments is conveyed except via the return value. Any function that might throw an error depending on the values of its arguments is not leak-proof. */
  proleakproof: boolean // bool
  /** Function returns null if any call argument is null. In that case the function won't actually be called at all. Functions that are not “strict” must be prepared to handle null inputs. */
  proisstrict: boolean // bool
  /** Function returns a set (i.e., multiple values of the specified data type) */
  proretset: boolean // bool
  /** provolatile tells whether the function's result depends only on its input arguments, or is affected by outside factors. It is i for “immutable” functions, which always deliver the same result for the same inputs. It is s for “stable” functions, whose results (for fixed inputs) do not change within a scan. It is v for “volatile” functions, whose results might change at any time. (Use v also for functions with side-effects, so that calls to them cannot get optimized away.) */
  provolatile: string // char
  /** proparallel tells whether the function can be safely run in parallel mode. It is s for functions which are safe to run in parallel mode without restriction. It is r for functions which can be run in parallel mode, but their execution is restricted to the parallel group leader; parallel worker processes cannot invoke these functions. It is u for functions which are unsafe in parallel mode; the presence of such a function forces a serial execution plan. */
  proparallel: string // char
  /** Number of input arguments */
  pronargs: number // int2
  /** Number of arguments that have defaults */
  pronargdefaults: number // int2
  /** Data type of the return value */
  prorettype: string // oid
  /** An array of the data types of the function arguments. This includes only input arguments (including INOUT and VARIADIC arguments), and thus represents the call signature of the function. */
  proargtypes: string[] // oidvector
  /** An array of the data types of the function arguments. This includes all arguments (including OUT and INOUT arguments); however, if all the arguments are IN arguments, this field will be null. Note that subscripting is 1-based, whereas for historical reasons proargtypes is subscripted from 0. */
  proallargtypes: string[] // oid[]
  /** An array of the modes of the function arguments, encoded as i for IN arguments, o for OUT arguments, b for INOUT arguments, v for VARIADIC arguments, t for TABLE arguments. If all the arguments are IN arguments, this field will be null. Note that subscripts correspond to positions of proallargtypes not proargtypes. */
  proargmodes: string[] // char[]
  /** An array of the names of the function arguments. Arguments without a name are set to empty strings in the array. If none of the arguments have a name, this field will be null. Note that subscripts correspond to positions of proallargtypes not proargtypes. */
  proargnames: string[] // text[]
  /** Expression trees (in nodeToString() representation) for default values. This is a list with pronargdefaults elements, corresponding to the last N input arguments (i.e., the last N proargtypes positions). If none of the arguments have defaults, this field will be null. */
  proargdefaults: any // pg_node_tree
  /** An array of the argument/result data type(s) for which to apply transforms (from the function's TRANSFORM clause). Null if none. */
  protrftypes: string[] // oid[]
  /** This tells the function handler how to invoke the function. It might be the actual source code of the function for interpreted languages, a link symbol, a file name, or just about anything else, depending on the implementation language/call convention. */
  prosrc: string // text
  /** Additional information about how to invoke the function. Again, the interpretation is language-specific. */
  probin: string // text
  /** Pre-parsed SQL function body. This is used for SQL-language functions when the body is given in SQL-standard notation rather than as a string literal. It's null in other cases. */
  prosqlbody: any // pg_node_tree
  /** Function's local settings for run-time configuration variables */
  proconfig: string[] // text[]
  /** Access privileges; see Section 5.7 for details */
  proacl: string // aclitem[]
}


/**
 * https://www.postgresql.org/docs/current/catalog-pg-namespace.html
 */
export interface PgNamespace {
  /** Row identifier */
  oid: Oid // oid
  /** Name of the namespace */
  nspname: string
  /** Owner of the namespace (references pg_authid.oid) */
  nspowner: Oid
  /** Access privileges; see Section [5.7](https://www.postgresql.org/docs/current/ddl-priv.html) for details */
  nspacl: string // ??
}


/**
 * https://www.postgresql.org/docs/current/catalog-pg-index.html
 */
export interface PgIndex {
  /** The OID of the pg_class entry for this index */
  indexrelid: string // oid
  /** The OID of the pg_class entry for the table this index is for */
  indrelid: string // oid
  /** The total number of columns in the index (duplicates pg_class.relnatts); this number includes both key and included attributes */
  indnatts: number // int2
  /** The number of key columns in the index, not counting any included columns, which are merely stored and do not participate in the index semantics */
  indnkeyatts: number // int2
  /** If true, this is a unique index */
  indisunique: boolean // bool
  /** This value is only used for unique indexes. If false, this unique index will consider null values distinct (so the index can contain multiple null values in a column, the default PostgreSQL behavior). If it is true, it will consider null values to be equal (so the index can only contain one null value in a column). */
  indnullsnotdistinct: boolean // bool
  /** If true, this index represents the primary key of the table (indisunique should always be true when this is true) */
  indisprimary: boolean // bool
  /** If true, this index supports an exclusion constraint */
  indisexclusion: boolean // bool
  /** If true, the uniqueness check is enforced immediately on insertion (irrelevant if indisunique is not true) */
  indimmediate: boolean // bool
  /** If true, the table was last clustered on this index */
  indisclustered: boolean // bool
  /** If true, the index is currently valid for queries. False means the index is possibly incomplete: it must still be modified by INSERT/UPDATE operations, but it cannot safely be used for queries. If it is unique, the uniqueness property is not guaranteed true either. */
  indisvalid: boolean // bool
  /** If true, queries must not use the index until the xmin of this pg_index row is below their TransactionXmin event horizon, because the table may contain broken HOT chains with incompatible rows that they can see */
  indcheckxmin: boolean // bool
  /** If true, the index is currently ready for inserts. False means the index must be ignored by INSERT/UPDATE operations. */
  indisready: boolean // bool
  /** If false, the index is in process of being dropped, and should be ignored for all purposes (including HOT-safety decisions) */
  indislive: boolean // bool
  /** If true this index has been chosen as “replica identity” using ALTER TABLE ... REPLICA IDENTITY USING INDEX ... */
  indisreplident: boolean // bool
  /** This is an array of indnatts values that indicate which table columns this index indexes. For example, a value of 1 3 would mean that the first and the third table columns make up the index entries. Key columns come before non-key (included) columns. A zero in this array indicates that the corresponding index attribute is an expression over the table columns, rather than a simple column reference. */
  indkey: number[] // int2vector
  /** For each column in the index key (indnkeyatts values), this contains the OID of the collation to use for the index, or zero if the column is not of a collatable data type. */
  indcollation: string[] // oidvector
  /** For each column in the index key (indnkeyatts values), this contains the OID of the operator class to use. See pg_opclass for details. */
  indclass: string[] // oidvector
  /** This is an array of indnkeyatts values that store per-column flag bits. The meaning of the bits is defined by the index's access method. */
  indoption: number[] // int2vector
  /** Expression trees (in nodeToString() representation) for index attributes that are not simple column references. This is a list with one element for each zero entry in indkey. Null if all index attributes are simple references. */
  indexprs: any // any
  /** Expression tree (in nodeToString() representation) for partial index predicate. Null if not a partial index. */
  indpred: any // any
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////


function camelcase(s: string) {
  return s[0].toUpperCase() + s.slice(1).replace(/_([\w])/g, (match, l) => l.toUpperCase())
}

export class PgtsType {

  _array_of: PgtsType | null = null
  _array_type: PgtsType | null = null
  _table: PgtsClass | null = null

  static map = new Map<string, PgtsType>()

  private static basic_types: {regexp: RegExp, jsname: string | ((s: string) => string), serializer: string | ((s: string) => string), default_exp: string}[] = []
  static registerBasicType(regexp: RegExp | string, jsname: string, serializer: string, default_exp: string) {
    if (typeof regexp === "string") {
      regexp = new RegExp("^" + regexp + "$")
    }
    this.basic_types.push({regexp, jsname, serializer, default_exp})
  }
  static getBasicType(name: string) {
    for (let ar = PgtsType.basic_types, i = ar.length - 1; i >= 0; i--) {
      const ser = ar[i]
      if (ser.regexp.test(name)) {
        return ser
      }
    }
  }

  constructor(public _pgtype: PgType, public _pg_namespace: PgNamespace) {
    PgtsType.map.set(_pgtype.oid, this)
  }

  get name() { return this._pgtype.typname }
  get isArray() { return this._array_of != null }

  get arrayType() { return this._array_type }
  get baseType() { return this._array_of }

  get jsTypeNameExp() {
    const name = this.jsName
    if (this._pgtype.typnotnull) return name
    return name + " | " + null
  }
  get jsName(): string {

    let name = this.name
    if (this.isArray) {
      return this._array_of!.jsName + "[]"
    }
    if (this.isComposite) {
      name = camelcase(name)
    } else {
      const basic = PgtsType.getBasicType(name)
      if (basic) {
        if (typeof basic.jsname === "function")
          name = basic.jsname(name)
        else
          name = basic.jsname
      }

    }
    // default
    return name
  }

  get jsSerializer(): string {
    if (this.isArray) {
      return this._array_of!.jsSerializer + ".array"
    }

    if (this.isComposite) {
      return `s.embed(() => ${this.jsName})`
    }

    let name = this.name
    for (let ar = PgtsType.basic_types, i = ar.length - 1; i >= 0; i--) {
      const ser = ar[i]
      if (ser.regexp.test(name)) {
        let exp = ser.serializer as string
        if (typeof ser.serializer === "function") {
          exp = ser.serializer(name)
        }
        return exp
      }
    }

    return `s.pgts_unknown_type__${name}`
  }

  get schema() { return this._pg_namespace.nspname }
  get isSystem() { return ["information_schema", "pg_catalog"].includes(this.schema) }
  get isComposite() { return this._pgtype.typtype === PgTypeKind.Composite }

}

const r = PgtsType.registerBasicType.bind(PgtsType)
r(/^(text|name|tsvector)/, "string", "s.str", `""`)
r(/^(int|float|numeric|real)/, "number", "s.num", "0")
r("bool", "boolean", "s.bool", "false")
r(/date|timestamp/, "Date", "s.date", "new Date()")
r("hstore", "Map<string, string>", "s.str.map", "new Map()")
r(/^json/, "unknown", "s.as_is", "null!")
r("void", "void", "", "null!")


export class PgtsColumn {
  type: PgtsType

  constructor(
    public _pg_attribute: PgAttribute,
    public _pg_description: PgDescription | null,
    public isPrimary: boolean,
    public default_exp: string
  ) {
    this.type = PgtsType.map.get(_pg_attribute.atttypid)!
  }

  get isNullable() { return !this._pg_attribute.attnotnull }
  get typeName() {
    return this.type.jsName + (this.isNullable ? " | null" : "")
  }
  get isSystem() { return this._pg_attribute.attnum <= 0 }
  get name() { return this._pg_attribute.attname }

  get defaultExp() {
    const def = this.default_exp
    if (this.type.isArray) return "[]"
    if (this.type.isComposite) return `new ${this.type.jsName}()`
    if (this.isNullable) return "null"

    if (def == null && !this.isPrimary) {
      const basic = PgtsType.getBasicType(this.type.name)
      if (basic) return basic.default_exp
    }

    if (def?.match(/::text$/)) {
      let r = def.replace(/::text$/, "").slice(1, -1).replace(/''/g, "'")
      return `'${r}'`
    } else if (def?.match(/^\d+(\.\d+)?/)) {
      return def
    }

    return `undefined! /* ${this.type.name} */ ${def != null ? `/* default: ${def} */` : ""}`
  }
}

export class PgtsFunctionArg {

  is_out = false
  constructor(public name: string, public type: PgtsType) {

  }

  get escapedName() { return `"${this.name.replace(/"/g, "\\\"")}"` }
}

export class PgtsFunction {
  constructor(
    public _pg_proc: PgProc,
    public _pg_namespace: PgNamespace
  ) {
    this._return_type = PgtsType.map.get(this._pg_proc.prorettype)!
    this._all_args = []
    let ret_idx = -1
    const argtypes = _pg_proc.proallargtypes ?? _pg_proc.proargtypes
    if (argtypes) {
      for (let i = 0, l = argtypes.length; i < l; i++) {
        const name = _pg_proc.proargnames?.[i] ?? `$${i+1}`
        const type = PgtsType.map.get(argtypes[i])!
        const mod = _pg_proc.proargmodes?.[i]
        if (mod === "t" && ret_idx === -1) { ret_idx = i }

        const arg = new PgtsFunctionArg(name, type)
        this._all_args.push(arg)
      }
    }

    this.args = this._all_args
    this.recordargs = []
    if (ret_idx > -1) {
      this.args = this._all_args.slice(0, ret_idx)
      this.recordargs = this._all_args.slice(ret_idx)
    }
  }

  _all_args: PgtsFunctionArg[]
  args: PgtsFunctionArg[]
  recordargs: PgtsFunctionArg[]
  _return_type: PgtsType

  get returnType() { return this._return_type }

  get returnTypeExp() {
    if (this._return_type.name === "record") {
      return "{" + this.recordargs.map(r => `${r.escapedName}: ${r.type.jsTypeNameExp}`).join(", ") + "}"
    }
    return this._return_type!.jsName
  }
  get returnsSet() {
    return this._pg_proc.proretset
  }

  get name() { return this._pg_proc.proname }
  get schema() { return this._pg_namespace.nspname }
  get isSystem() { return ["information_schema", "pg_catalog"].includes(this.schema) }
  get isTrigger() { return this.returnType.name === "trigger" }

}


/**
 * Classes are all table-like structures
 */
export class PgtsClass {

  type: PgtsType
  columns: PgtsColumn[]

  get primary_keys() { return this.columns.filter(c => c.isPrimary) }

  constructor(
    public _pg_class: PgClass,
    public _pg_namespace: PgNamespace,
    public _pg_description: PgDescription | null,
    _pg_columns: GetTableLikeRow["columns"]
  ) {
    this.type = PgtsType.map.get(_pg_class.reltype)!
    this.type._table = this
    this.columns = _pg_columns.map(c => new PgtsColumn(c.pg_attribute, c.pg_description, c.is_primary, c.default))
  }

  get name() { return this._pg_class.relname }
  get jsName() { return this.type.jsName }

  get hasPrimaryKey() { return this.columns.some(c => c.isPrimary) }
  get isView() { return this._pg_class.relkind === "v" }
  get schema() { return this._pg_namespace.nspname }
  get isSystem() { return ["information_schema", "pg_catalog"].includes(this.schema) }

  get displayKind() {
    // r = ordinary table, i = index, S = sequence, t = TOAST table, v = view, m = materialized view, c = composite type, f = foreign table, p = partitioned table, I = partitioned index
    switch (this._pg_class.relkind) {
      case "r": return "table"
      case "i": return "index"
      case "S": return "sequence"
      case "t": return "toast"
      case "v": return "view"
      case "m": return "materialized-view"
      case "c": return "composite-type"
      case "f": return "foreign table"
      case "p": return "partitioned table"
      case "I": return "partitioned index"
      default:
        "<unknown>"
    }
  }

}


export async function get_all_types() {
  if (PgtsType.map.size > 0) return

  const res = await c.query<{pg_type: PgType, pg_namespace: PgNamespace}>(/* sql */ `
    SELECT
      row_to_json(ty) as pg_type,
      row_to_json(nms) as pg_namespace
    FROM pg_type ty inner join pg_namespace nms ON nms.oid = ty.typnamespace`)
  const r = res.rows.map(m => new PgtsType(m.pg_type, m.pg_namespace))
  for (let typ of r) {
    if (Number(typ._pgtype.typarray)) {
      let artype = PgtsType.map.get(typ._pgtype.typarray)!
      artype._array_of = typ
      typ._array_type = artype
    }
  }
  return r
}

export interface GetTableLikeRow {
  pg_class: PgClass
  pg_namespace: PgNamespace
  pg_description: PgDescription | null,
  pg_indices: PgIndex[],
  columns: {
    pg_attribute: PgAttribute
    default: string
    pg_description: PgDescription | null
    is_primary: boolean
  }[]
}

export async function get_table_like() {
  await get_all_types()

  const res = await c.query<GetTableLikeRow>(/* sql */`
    SELECT
      row_to_json(cl) as pg_class,
      row_to_json(nm) as pg_namespace,
      (SELECT coalesce(json_agg(row_to_json(id)), '[]'::json) FROM pg_index id WHERE id.indrelid = cl.oid) as pg_indices,
      (SELECT row_to_json(dc) FROM pg_description dc WHERE dc.objoid = cl.oid AND dc.objsubid = 0) as pg_description,
      (SELECT
          json_agg(json_build_object(
            'pg_attribute', row_to_json(attr),
            'default', (SELECT pg_get_expr(def.adbin, def.adrelid) FROM pg_attrdef def WHERE def.adrelid = cl.oid AND def.adnum = attr.attnum),
            'pg_description', (SELECT row_to_json(dc2) FROM pg_description dc2 WHERE dc2.objoid = cl.oid AND dc2.objsubid = attr.attnum),
            'is_primary', coalesce((SELECT indisprimary FROM pg_index id WHERE id.indrelid = cl.oid AND attr.attnum = any (id.indkey) LIMIT 1), false)
          ) ORDER BY attr.attnum) as columns
        FROM pg_attribute attr
          INNER JOIN pg_type aty on aty.oid = attr.atttypid
          WHERE attr.attrelid = cl.oid
      ) as columns
    FROM pg_namespace nm
      INNER JOIN pg_class cl ON cl.relnamespace = nm.oid
      INNER JOIN pg_type ty ON ty.oid = cl.reltype
      WHERE cl.relkind = any ($1)
  `, [[
    PgClassRelKind.CompositeType,
    PgClassRelKind.MaterializedView,
    PgClassRelKind.View,
    PgClassRelKind.Table,
  ]])

  const result = res.rows.map(r => new PgtsClass(r.pg_class, r.pg_namespace, r.pg_description, r.columns))
  return result
  // const clss = await Promise.all(res.rows.map(r => t.PgtsClass.fromRequest(r)))

  // console.log(clss.filter(c => c.schema === "api"))
}


export interface GetProcRow {
  pg_proc: PgProc
  pg_namespace: PgNamespace
}



export async function get_functions() {
  await get_all_types()

  const res = await c.query<GetProcRow>(/* sql */`
    SELECT
      row_to_json(pr) as pg_proc,
      row_to_json(nm) as pg_namespace
    FROM pg_proc pr
      INNER JOIN pg_namespace nm ON nm.oid = pr.pronamespace
  `)

  return res.rows.map(p => new PgtsFunction(p.pg_proc, p.pg_namespace))
}