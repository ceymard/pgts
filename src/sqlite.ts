import { inspect } from "util"
import * as path from "path"
import * as fs from "fs"

import * as D from "better-sqlite3"

const dbname = process.argv[2]
assert(dbname, "please give sqlite database name")
const db = new D(dbname, { readonly: true, fileMustExist: true, })

export function log(m: any) {
  console.warn(inspect(m, {colors: true, depth: null}))
}

export interface SqliteColumn {
  cid: number
  name: string
  type: string
  notnull: boolean
  default: string
  pk: boolean
  hidden: boolean
}

export interface SqliteTable {
  schema: string
  name: string
  type: string
  ncol: number
  wr: number
  strict: number
}

export interface SqliteForeignKey {
  id: number
  seq: number
  table: string // dest table 'users'
  from: string // column 'username' in current table
  to: string // column 'username' in distant table
  on_update: string // 'NO ACTION',
  on_delete: string // 'NO ACTION',
  match: string // 'NONE'
}

export interface Parameter {
  parameter_name: string
  udt_name: string
}


export const type_maps = new Map<string, [string, string]>()
  .set("date", ["Date", "UTCDateSerializer"])
  .set("timestamp", ["Date", "UTCDateSerializer"])
  .set("timestampz", ["Date", "UTCDateSerializer"])
  .set("hstore", ["Map<string, string>", "HstoreSerializer"])


const file = process.argv[3]
if (!file)
  throw new Error("Please give a filename")

let contents: string
try {
  contents = fs.readFileSync(file, "utf-8")
} catch (e) {
  contents = ""
}
// console.log(contents)

const re_impl_blocks = /!impl ([^\s*]+)\s*\*\*\/\s*\n((.|\n)*?)(?:\s|\n)*\/\*\*\s*!end impl/img

const impl_blocks: {[name: string]: string} = {}
let match: RegExpMatchArray | null
while ((match = re_impl_blocks.exec(contents))) {
  impl_blocks[match[1]] = match[2] + "\n"
}


const out = file === "-" ? process.stdout as unknown as fs.WriteStream : fs.createWriteStream(file, "utf-8")

out.write(fs.readFileSync(path.join(__dirname, "../src/prelude-sqlite.ts"), "utf-8")
  .replace(re_impl_blocks, (match, name, contents) => {
    // console.log(name)
    if (impl_blocks[name])
      return match.replace(contents, impl_blocks[name])
    return match
  })
)

const tables = query<SqliteTable>(/* sql */`
  PRAGMA table_list
`)

for (const t of tables) {
  const table_name = t.name
  if (t.name.startsWith("sqlite") || t.name.startsWith("_")) continue

  const columns = query<SqliteColumn>(/* sql */`PRAGMA table_xinfo("${table_name}")`)

  // maybe parse the create table statement ?
  // if (t.comment) {
  //   out.write(`/**\n${t.comment.split("\n").map(c => ` * ${c}`).join("\n")}\n */\n`)
  // }
  out.write("export class ")
  out.write(camelcase(table_name))
  out.write(" extends Model {\n")
  out.write(`  get [Cons]() { return ${camelcase(table_name)} }\n`)
  out.write(`  static url = "/lite/${table_name}"\n`)

  const indices = columns.filter(a => a.pk).map(a => a.name)
  if (indices.length > 0) {
    out.write(`  static pk = [${indices.map(i => `"${i}"`).join(", ")}]\n`)
    out.write("  oldpk: any[] = undefined as any\n")
    out.write(`public static OnDeserialized(inst: ${camelcase(table_name)}, json : any) {
      inst.oldpk = this.pk.map(k => (inst as any)[k])
    }`)
  }

  const create_def = [] as string[]
  const seen = new Set<string>()
  for (const col of columns) {
    col.type = col.type.toLowerCase()
    col.name = col.name.toLowerCase()

    if (seen.has(col.name)) continue
    seen.add(col.name)
    const colname = col.name.match(/\s+/) ? `"${col.name}"` : col.name
    // if (col.comment) {
    //   out.write("  /**\n")
    //   out.write(col.comment.split("\n").map(c => `   * ${c}`).join("\n"))
    //   out.write("\n   */\n")
    // }
    // out.write(col.udt_name)

    const values = get_values(table_name, col)
    const [udt_name, serial] = handle_udt_name(col.type.toLowerCase())
    let final_type = values ?? udt_name
    if (!col.notnull)
      final_type += " | null"

    const custom_type = !values && !udt_name.match(/^(string|number|boolean|Jsonb?)(\[\])?$/) && !udt_name.includes("|")
    // console.warn(colname, custom_type, col.type)
    // console.log(colname)
    out.write(`  ${!custom_type ? "@a" :
      col.type === "date" || col.type === "timestamp" || col.type === "timestamptz" ? "@aa(UTCDateSerializer)" :
        `@aa(${serial})`} ${colname}: `)

    out.write(final_type)
    // out.write(` // ${col.type}`)

    if (col.default) {
      out.write(` = ${handle_default_value(col.default)}`)
    } else if (!col.notnull) {
      out.write(" = null")
    } else if (udt_name.includes("[]")) { // we have an array.
      out.write(" = []")
    } else if (custom_type) {
      out.write(` = new ${udt_name}()`)
    } else {
      out.write(" = undefined as any")
    }
    create_def.push(`${colname}${col.default || !col.notnull ? "?" : ""}: ${final_type}`)
    out.write("\n")
  }
  // log(create_def.join(', '))
  out.write(`\n  static async createInDb(defs: {${create_def.join(", ")}}) {
  const val = new this()
  Object.assign(val, defs)
  return await val.save()
}`)

  out.write(`\n\n  static create(defs: {${create_def.join(", ")}}) {
  const val = new this()
  Object.assign(val, defs)
  return val
}`)

  out.write(`\n  /** !impl ${camelcase(table_name)} **/\n`)
  out.write(impl_blocks[camelcase(table_name)] || "    // extend this class here\n")
  out.write("\n  /** !end impl **/\n")
  out.write("}\n\n")
}

function assert(cond: any, msg?: string): asserts cond {
  if (!cond) throw new Error(msg ?? "assertion failed")
}


function camelcase(s: string) {
  return s[0].toUpperCase() + s.slice(1).replace(/\./g, "").replace(/_([\w])/g, (match, l) => l.toUpperCase())
}

function query<T>(sql: string, ...values: any[]): T[] {
  // console.error(sql, values)
  // console.error(sql)
  const stmt = db.prepare(sql)
  return stmt.all(...values) as any
}

function get_values(table: string, col: SqliteColumn) {
  if (col.type !== "text")
    return null
  // console.error(table, col)

  const fks = query<SqliteForeignKey>(/* sql */ `PRAGMA foreign_key_list("${table}")`).filter(fcol => fcol.from === col.name)
  // console.error(fks)

  if (!fks || fks.length !== 1)
    return null
  const fk = fks[0]

  // log(real_res)
  // if (real_res.table_name === table && real_res.column_name === col.name) {
  //   return handle_udt_name(real_res.foreign_table_name)[0] + `["${real_res.foreign_column_name}"]`
  // }

  const values = query<{val: string}>(/* sql */`SELECT distinct "${fk.to}" as val
    FROM "${fk.table}"
    ORDER BY val
  `)

  if (values.length >= 50)
    return null
  return values.map(r => `"${r.val.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/"/g, "\\\"")}"`).join(" | ")
  // log()

}

function handle_udt_name(s: string): [string, string] {
  // log(s)
  s = s || "text" // sqlite default type affinity

  const arr = (s[0] === "_")
  let arrsuffix = ""
  if (arr) {
    arrsuffix = "[]" // FIXME should get dimensions
    s = s.slice(1)
  }
  let type = s.toLowerCase()
  // console.error(type)

  if (s.match(/^(int|float)\d*$/))
    type = "number"
  else if (s === "text" || s === "name")
    type = "string"
  else if (s === "bool")
    type = "boolean"
  else if (s === "void")
    type = "void"
  // else if (s === 'json' || s === 'jsonb')
  //   type = 'any'
  else if (type_maps.has(s)) {
    const [typ, ser] = type_maps.get(s)!
    return [typ + arrsuffix, ser]
  } else {
    type = "string"
  }
  return [type + (arr ? "[]" : ""), type]
}


function handle_default_value(s: string) {
  // console.log(s)
  let m: RegExpExecArray | null
  if ((m = /'(.*)'::jsonb?/.exec(s) || /(.*)::text$/.exec(s))) {
    return m[1] == "''" ? "\"\"" : m[1]
  }
  if ((m = /'\{\}'::text\[\]/.exec(s))) {
    return "[]"
  }
  if ((m = /'(.*)'::(.*)\.hstore/.exec(s))) {
    return "new Map()"
  }
  return `undefined! // ${s}`
}
