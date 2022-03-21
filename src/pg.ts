import { Client } from "pg"
import { inspect } from "util"
import * as path from "path"
import * as fs from "fs"

const DB = process.argv[2]
if (!DB) throw new Error("Please give database")
const SCHEMA = (process.argv[4] || "public")


export function log(m: any) {
  console.warn(inspect(m, {colors: true, depth: null}))
}


export interface PgType {
  typname: string
  typnamespace: string // really number
  typowner: string // really number
  typlen: number
  typbyval: boolean
  typtype: string
  typcategory: string
  typispreferred: boolean
  typdelim: string
  typrelid: string // really number
  typelem: string
  typarray: string
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
 * The result type from pgattribute
 */
export interface PgAttribute {
  attrelid: number
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


export interface ColumnResult {
  table_catalog: string
  table_schema: string
  table_name: string
  column_name: string
  ordinal_position: number
  column_default: string // expression à parser ?
  is_nullable: "YES" | "NO"
  data_type: string // This is what we want !
  udt_catalog: string
  udt_schema: string // this is where we would want to go fetch our custom types if we had some
  udt_name: string // with this name.
  is_updatable: "YES" | "NO"
  comment: string | null
}


export interface Parameter {
  parameter_name: string
  udt_name: string
}


function camelcase(s: string) {
  return s[0].toUpperCase() + s.slice(1).replace(/_([\w])/g, (match, l) => l.toUpperCase())
}

async function query(c: Client, sql: string, values?: any[]) {
  // console.error(sql, values)
  return c.query(sql, values)
}

async function get_values(c: Client, table: string, col: PgAttribute & PgType) {
  if (col.typname !== "text")
    return null

  const res =  await query(c, /* sql */ `SELECT
    tc.table_schema,
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_schema AS foreign_table_schema,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
  FROM
    information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
  WHERE
    tc.constraint_type = 'FOREIGN KEY'
    AND
    (tc.table_name = $1
    AND tc.table_schema = $2
    AND kcu.column_name = $3
    OR
    ccu.table_name = $1
    AND ccu.table_schema = $2
    AND ccu.column_name = $3
    )
  `, [table, SCHEMA, col.attname])

  const real_res = res.rows[0] as {
    table_schema: string
    constraint_name: string
    table_name: string
    column_name: string
    foreign_table_name: string
    foreign_table_schema: string
    foreign_column_name: string
  }
  // console.log(table, col.attname, col)

  if (!real_res)
    return null

  // log(real_res)
  if (real_res.table_name === table && real_res.column_name === col.attname) {
    return handle_udt_name(real_res.foreign_table_name)[0] + `["${real_res.foreign_column_name}"]`
  }

  const values = await query(c, /* sql */`SELECT distinct "${real_res.foreign_column_name}" as val
    FROM "${real_res.foreign_table_schema}"."${real_res.foreign_table_name}"
    ORDER BY val
  `)

  if (values.rows.length >= 50)
    return null
  return values.rows.map(r => `"${r.val.replace(/'/g, "\\'")}"`).join(" | ")
  // log()

}

export const type_maps = new Map<string, [string, string]>()
  .set("date", ["Date", "UTCDateSerializer"])
  .set("timestamp", ["Date", "UTCDateSerializer"])
  .set("timestampz", ["Date", "UTCDateSerializer"])
  .set("hstore", ["Map<string, string>", "HstoreSerializer"])


function handle_udt_name(s: string): [string, string] {
  // log(s)
  const arr = (s[0] === "_")
  let arrsuffix = ""
  if (arr) {
    arrsuffix = "[]" // FIXME should get dimensions
    s = s.slice(1)
  }
  let type = s.toLowerCase()

  if (s.match(/^(int|float)\d+$/))
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
  } else
    type = camelcase(s)
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


async function run() {

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
  // console.log(impl_blocks)

  const c = new Client(DB)
  await c.connect()

  await query(c, `SET SCHEMA '${SCHEMA}'`)

  // console.log('connected')

  const types = await query(c, /* sql */ `
    SELECT
      row_to_json(typ) as "type",
      d.description as comment,
      (SELECT json_agg(att ORDER BY att.attnum) FROM
        (SELECT att.*, typ2.*, d2.description as comment, pg_get_expr(de.adbin, de.adrelid) as default, id.indisprimary as is_primary FROM pg_attribute att
          INNER JOIN pg_type typ2 ON typ2.oid = att.atttypid
          LEFT JOIN pg_description d2 ON
            d2.objoid = typ.typname::regclass::oid AND d2.objsubid = att.attnum
          LEFT JOIN pg_attrdef de ON
            de.adrelid = typ.typname::regclass::oid AND de.adnum = att.attnum
          LEFT JOIN pg_index id ON
            id.indrelid = att.attrelid AND att.attnum = any (id.indkey)
        WHERE att.attrelid = typ.typname::regclass::oid
          AND att.attname NOT IN ('tableoid', 'cmax', 'xmax', 'cmin', 'xmin', 'ctid')
        ) att
      ) as attributes
    FROM pg_namespace nam INNER JOIN
      pg_type typ ON typ.typnamespace = nam.oid LEFT JOIN
      pg_description d ON d.objoid = typ.typname::regclass::oid AND d.objsubid = 0
    WHERE nam.nspname = $1
      AND typ.typname[0] <> '_'
    ORDER BY typ.oid
  `, [SCHEMA])

  const typrows = types.rows as {type: PgType, comment: string | null, attributes: (PgType & PgAttribute & {comment: string | null, default: string | null, is_primary: boolean | null})[]}[]

  const out = file === "-" ? process.stdout as unknown as fs.WriteStream : fs.createWriteStream(file, "utf-8")

  out.write(fs.readFileSync(path.join(__dirname, "../src/prelude.ts"), "utf-8")
    .replace(re_impl_blocks, (match, name, contents) => {
      // console.log(name)
      if (impl_blocks[name])
        return match.replace(contents, impl_blocks[name])
      return match
    })
  )

  for (const r of typrows) {
    const table_name = r.type.typname

    if (r.comment) {
      out.write(`/**\n${r.comment.split("\n").map(c => ` * ${c}`).join("\n")}\n */\n`)
    }
    out.write("export class ")
    out.write(camelcase(table_name))
    out.write(" extends Model {\n")
    out.write(`  get [Cons]() { return ${camelcase(table_name)} }\n`)
    out.write(`  static url = "/pg/${table_name}"\n`)

    const indices = r.attributes.filter(a => a.is_primary).map(a => a.attname)
    if (indices.length > 0) {
      out.write(`  static pk = [${indices.map(i => `"${i}"`).join(", ")}]\n`)
    }

    const create_def = [] as string[]
    const seen = new Set<string>()
    for (const col of r.attributes) {
      if (seen.has(col.attname)) continue
      seen.add(col.attname)
      const colname = col.attname.match(/\s+/) ? `"${col.attname}"` : col.attname
      if (col.comment) {
        out.write("  /**\n")
        out.write(col.comment.split("\n").map(c => `   * ${c}`).join("\n"))
        out.write("\n   */\n")
      }
      // out.write(col.udt_name)

      const values = await get_values(c, table_name, col)
      const [udt_name, serial] = handle_udt_name(col.typname)
      let final_type = values ?? udt_name
      if (!col.attnotnull)
        final_type += " | null"

      const custom_type = !values && !udt_name.match(/^(string|number|boolean|Jsonb?)(\[\])?$/) && !udt_name.includes("|")
      // console.warn(colname, custom_type, col.typname)
      // console.log(colname)
      out.write(`  ${!custom_type ? "@a" :
        col.typname === "date" || col.typname === "timestamp" || col.typname === "timestamptz" ? "@aa(UTCDateSerializer)" :
          `@aa(${serial})`} ${colname}: `)

      out.write(final_type)
      // out.write(` // ${col.typname}`)

      if (col.default) {
        out.write(` = ${handle_default_value(col.default)}`)
      } else if (!col.attnotnull) {
        out.write(" = null")
      } else if (udt_name.includes("[]")) { // we have an array.
        out.write(" = []")
      } else if (custom_type) {
        out.write(` = new ${udt_name}()`)
      } else {
        out.write(" = undefined!")
      }
      create_def.push(`${colname}${col.default || !col.attnotnull ? "?" : ""}: ${final_type}`)
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

  const functions_new = await c.query(/* sql */`
    SELECT
      pro.proname as name,
      pro.proargmodes::text[] as arg_modes,
      pro.proargnames::text[] as arg_names,
      typ2.typname as rettype,
      typ2.typrelid as relid,
      COALESCE(JSON_AGG(json_build_object('type', typ.typname, 'notnull', typ.typnotnull) ORDER BY ordinality) FILTER (WHERE typ.typname IS NOT NULL), '[]') as args
    FROM pg_namespace name
    INNER JOIN pg_proc pro
      ON pro.pronamespace = name.oid
    LEFT JOIN unnest(COALESCE(pro.proallargtypes, pro.proargtypes)) WITH ORDINALITY as u(type_oid, ordinality) ON true
    LEFT JOIN pg_type typ ON typ.oid = type_oid
    INNER JOIN pg_type typ2 ON typ2.oid = pro.prorettype
    WHERE name.nspname = $1 AND typ2.typname <> 'trigger'
    GROUP BY pro.proname, pro.proargmodes, pro.proargnames, typ2.typname, typ2.typrelid
  `, [SCHEMA])
  // information_schema.routines
  // information_schema.parameters
  // console.error(functions_new.rows)

  for (const f2 of functions_new.rows) {
    const therow = f2 as {name: string, arg_names: string[], arg_modes: string[], rettype: string, relid: number, args: {type: string, notnull: boolean}[]}
    let orig_args = therow.args.map(a => a.type)
    let args = therow.args.map(a => handle_udt_name(a.type))
    let notnulls = therow.args.map(a => !!a.notnull)
    let names = therow.arg_names
    let [result, serial] = handle_udt_name(therow.rettype)

    // If we have a relid, it means this function is returning a table row type
    // Postgrest seems to think this means we will return an array.
    if (therow.relid)
      result = result + "[]"

    if (therow.rettype === "record" ) {
      // Find first argument which is table
      if (!therow.arg_modes) {
        result = "any[]"
      } else {
        const idx = therow.arg_modes.indexOf("t")
        const resargs = args.slice(idx)
        const resnames = names.slice(idx)
        notnulls = notnulls.slice(idx)
        orig_args = orig_args.slice(idx)
        args = args.slice(0, idx)
        names = names.slice(0, idx)
        // out.write('---' + JSON.stringify({names: resnames, args: resargs}))
        result = `{${resargs.map((t, i) => `${resnames[i]}: ${t[0]}${!notnulls[i] ? " | null" : ""}`).join(", ")}}[]`
      }
    } else if ((therow.arg_modes ?? []).includes("t")) {
      const idx = therow.arg_modes.indexOf("t")
      // resargs = args.slice(idx)
      // resnames = names.slice(idx)
      notnulls = notnulls.slice(idx)
      orig_args = orig_args.slice(idx)
      args = args.slice(0, idx)
      names = names.slice(0, idx)
    }

    const final_args = args.map((a, i) => `${names[i]}: ${a[0]}`).join(", ")
    // out.write(therow.name, final_args, result)

    out.write(`export function ${therow.name}(${final_args}): Promise<${result}> {\n`)
    // out.write(`  /** !impl ${therow.name}**/\n`)
    out.write(`  return POST("/pg/rpc/${therow.name}", JSON.stringify({${(names||[])
      .map((n, i) =>
        orig_args[i] === "date" || orig_args[i] === "timestamp" || orig_args[i] === "timestamptz" ? `${n}: UTCDateSerializer.Serialize(${n})` : n)
      .join(", ")}}))\n`)
    // console.error(result)
    if (result !== "Json" && result !== "Jsonb" && result.match(/[A-Z]/) && !result.match(/\|/)) {
      out.write(`    .then(v => Deserialize(v, ${serial}))`)
    }
    // out.write(`  /** !end impl **/\n`)
    out.write("\n}\n\n")
  }

  await c.end()
}


run().catch(e => console.error(e))
