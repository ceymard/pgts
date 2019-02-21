import { Client } from 'pg'
import { inspect } from 'util'
import * as path from 'path'
import * as fs from 'fs'

const DB = 'postgres://administrator:admin@172.18.0.2/app'
const SCHEMA = 'api'


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
  is_nullable: 'YES' | 'NO'
  data_type: string // This is what we want !
  udt_catalog: string
  udt_schema: string // this is where we would want to go fetch our custom types if we had some
  udt_name: string // with this name.
  is_updatable: 'YES' | 'NO'
  comment: string | null
}


export interface Parameter {
  parameter_name: string
  udt_name: string
}


function camelcase(s: string) {
  return s[0].toUpperCase() + s.slice(1).replace(/_([\w])/g, (match, l) => l.toUpperCase())
}


async function get_values(c: Client, table: string, col: PgAttribute & PgType) {
  if (col.typname !== 'text')
    return null

  const res = /* sql */ await c.query(`SELECT
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

  if (!real_res)
    return null

  // log(real_res)
  if (real_res.table_name === table) {
    return handle_udt_name(real_res.foreign_table_name) + `['${real_res.foreign_column_name}']`
  }

  const values = await c.query(`SELECT distinct "${real_res.foreign_column_name}" as val
    FROM "${real_res.foreign_table_schema}"."${real_res.foreign_table_name}"
    ORDER BY val
  `)

  if (values.rows.length >= 50)
    return null
  return values.rows.map(r => `'${r.val.replace(/'/g, '\\\'')}'`).join(' | ')
  // log()

}



function handle_udt_name(s: string, col?: ColumnResult) {
  // log(s)
  var arr = (s[0] === '_')
  if (arr)
    s = s.slice(1)
  var type = s

  if (s.match(/^(int|float)\d+$/))
    type = 'number'
  else if (s === 'text' || s === 'name') {
    type = 'string'
  } else if (s === 'date' || s === 'timestamp')
    type = 'Date | string'
  else if (s === 'bool')
    type = 'boolean'
  else if (s === 'void')
    type = 'void'
  else
    type = camelcase(s)
  return type + (arr ? '[]' : '')
}


function handle_default_value(s: string) {
  var m: RegExpExecArray | null
  if (m = /'(.*)'::json/.exec(s) || /(.*)::text$/.exec(s)) {
    return m[1]
  }
  if (m = /'\{\}'::text\[\]/.exec(s)) {
    return '[]'
  }
  return `undefined! // ${s}`
}


export function udt(name: string) {
  return handle_udt_name(name).replace(/^./, m => m.toUpperCase())
}


async function run() {

  const file = process.argv[2]
  if (!file)
    throw new Error('Please give a filename')

  const contents = fs.readFileSync(file, 'utf-8')
  // console.log(contents)

  const re_impl_blocks = /!impl ([^\s*]+)\s*\*\*\/\s*\n((.|\n)*?)\n\s*\/\*\*\s*!end impl/img

  const impl_blocks: {[name: string]: string} = {}
  var match: RegExpMatchArray | null
  while (match = re_impl_blocks.exec(contents)) {
    impl_blocks[match[1]] = match[2] + '\n'
  }

  const c = new Client(DB)
  // console.log('wha')
  await c.connect()

  await c.query(`SET SCHEMA '${SCHEMA}'`)

  // console.log('connected')

  const types = await c.query(/* sql */ `
    SELECT
      row_to_json(typ) as "type",
      d.description as comment,
      (SELECT json_agg(att ORDER BY att.attnum) FROM
        (SELECT att.*, typ2.*, d2.description as comment, de.adsrc as default FROM pg_attribute att
          INNER JOIN pg_type typ2 ON typ2.oid = att.atttypid
          LEFT JOIN pg_description d2 ON
            d2.objoid = typ.typname::regclass::oid AND d2.objsubid = att.attnum
          LEFT JOIN pg_attrdef de ON
            de.adrelid = typ.typname::regclass::oid AND de.adnum = att.attnum
        WHERE att.attrelid = typ.typname::regclass::oid
          AND att.attname NOT IN ('tableoid', 'cmax', 'xmax', 'cmin', 'xmin', 'ctid')
        ) att
      ) as attributes
    FROM pg_namespace nam INNER JOIN
      pg_type typ ON typ.typnamespace = nam.oid LEFT JOIN
      pg_description d ON d.objoid = typ.typname::regclass::oid AND d.objsubid = 0
    WHERE nam.nspname = $1
      AND typ.typname[0] <> '_'
  `, [SCHEMA])

  const typrows = types.rows as {type: PgType, comment: string | null, attributes: (PgType & PgAttribute & {comment: string | null, default: string | null})[]}[]

  // log(typrows.map(r => {return {
  //   name: r.type.typname,
  //   kind: r.type.typrelid,
  //   comment: r.comment,
  //   attrs: r.attributes.map(a => { return { name: a.attname, comment: a.comment, type: a.typname, def: a.default } })
  // }}))

  // process.exit(0)

  const out = fs.createWriteStream(file, 'utf-8')


  out.write(fs.readFileSync(path.join(__dirname, '../src/prelude.ts'), 'utf-8')
    .replace(re_impl_blocks, (match, name, contents) => {
      if (impl_blocks[name])
        return match.replace(contents, impl_blocks[name])
      return match
    })
  )

  for (var r of typrows) {
    const table_name = r.type.typname

    if (r.comment) {
      out.write(`/**\n${r.comment.split('\n').map(c => ` * ${c}`).join('\n')}\n */\n`)
    }
    out.write('export class ')
    out.write(camelcase(table_name))
    out.write(' extends Model {\n')
    out.write(`  static url = '/pg/${table_name}'\n`)
    for (var col of r.attributes) {
      const colname = col.attname
      if (col.comment) {
        out.write(`  /**\n`)
        out.write(col.comment.split('\n').map(c => `   * ${c}`).join('\n'))
        out.write(`\n   */\n`)
      }
      // out.write(col.udt_name)

      const values = await get_values(c, table_name, col)
      const udt_name = handle_udt_name(col.typname)
      const needs_deser = !values && !udt_name.match(/^(string|number|boolean|Json)(\[\])?$/) && !udt_name.includes('|')
      out.write(`  ${!needs_deser ? '@a' : `@aa(${udt_name.replace('[]', '')})`} ${colname}: `)
      if (values) {
        out.write(values)
      } else {
        out.write(udt_name)
      }

      if (!col.attnotnull) {
        out.write(' | null')
      }
      if (col.default) {
        out.write(` = ${handle_default_value(col.default)}`)
      } else if (!col.attnotnull) {
        out.write(` = null`)
      } else {
        out.write(` = undefined!`)
      }
      out.write('\n')
    }
    out.write(`\n  /** !impl ${camelcase(table_name)} **/\n`)
    out.write(impl_blocks[camelcase(table_name)] || `    // extend this class here\n`)
    out.write(`\n  /** !end impl **/\n`)
    out.write('}\n\n')
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

  for (var f2 of functions_new.rows) {
    const therow = f2 as {name: string, arg_names: string[], arg_modes: string[], rettype: string, relid: number, args: {type: string, notnull: boolean}[]}
    var args = therow.args.map(a => handle_udt_name(a.type))
    var notnulls = therow.args.map(a => !!a.notnull)
    var names = therow.arg_names
    var result = handle_udt_name(therow.rettype)

    // If we have a relid, it means this function is returning a table row type
    // Postgrest seems to think this means we will return an array.
    if (therow.relid)
      result = result + '[]'

    if (therow.rettype === 'record') {
      // Find first argument which is table
      var idx = therow.arg_modes.indexOf('t')
      var resargs = args.slice(idx)
      var resnames = names.slice(idx)
      var notnulls = notnulls.slice(idx)
      args = args.slice(0, idx)
      names = names.slice(0, idx)
      result = `{${resargs.map((t, i) => `${resnames[i]}: ${t}${!notnulls[i] ? ' | null' : ''}`).join(', ')}}[]`
    }

    var final_args = args.map((a, i) => `${names[i]}: ${a}`).join(', ')
    // out.write(therow.name, final_args, result)

    out.write(`export function ${therow.name}(${final_args}): Promise<${result}> {\n`)
    out.write(`  /** !impl ${therow.name}**/\n`)
    out.write(impl_blocks[therow.name] || `  return POST('/pg/rpc/${therow.name}', JSON.stringify({${(names||[]).join(', ')}}))\n`)
    out.write(`  /** !end impl **/\n`)
    out.write('\n}\n\n')
  }

  await c.end()
}


run().catch(e => console.error(e))
