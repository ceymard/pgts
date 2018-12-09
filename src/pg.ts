import { Client } from 'pg'
import { inspect } from 'util'

const DB = 'postgres://administrator:admin@dev.intra.pg/app'
const SCHEMA = 'api'


export function log(m: any) {
  console.log(inspect(m, {colors: true, depth: null}))
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

function handle_udt_name(s: string) {
  var arr = (s[0] === '_')
  if (arr)
    s = s.slice(1)
  var type = s

  if (s.match(/^(int|float)\d+$/))
    type = 'number'
  else if (s === 'text')
    type = 'string'
  else if (s === 'date')
    type = 'Date'
  else if (s === 'bool')
    type = 'boolean'
  else if (s === 'void')
    type = 'void'
  else
    type = camelcase(s)
  return type + (arr ? '[]' : '')
}

export function udt(name: string) {
  return handle_udt_name(name).replace(/^./, m => m.toUpperCase())
}


async function run() {
  const c = new Client(DB)
  // console.log('wha')
  await c.connect()

  await c.query(`SET SCHEMA '${SCHEMA}'`)

  // console.log('connected')

  const res = await c.query(`
    SELECT
      t.table_name,
      d.description as comment,
      (SELECT json_agg(T) FROM (
        SELECT
          c.*,
          d2.description as comment
        FROM information_schema.columns c
          LEFT JOIN pg_description d2
            ON d2.objoid = ($1 || '.' || t.table_name)::regclass::oid AND d2.objsubid = c.ordinal_position
        WHERE
          c.table_schema = t.table_schema
          AND c.table_name = t.table_name
      ) T) as columns
    FROM
      information_schema.tables t
      LEFT JOIN pg_description d ON d.objoid = ($1 || '.' || t.table_name)::regclass::oid AND d.objsubid = 0
    WHERE
      table_schema = $1
  `, [SCHEMA])

  const rows = res.rows as {table_schema: string, table_name: string, comment: string | null, columns: ColumnResult[]}[]
  // log(rows)

  // process.exit(0)

  const out = process.stdout

  for (var r of rows) {
    if (r.comment) {
      out.write(`/**\n${r.comment.split('\n').map(c => ` * ${c}`).join('\n')}\n */\n`)
    }
    console.log('export class', camelcase(r.table_name), 'extends Model {')
    console.log(`  static readonly url = '/pg/${r.table_name}'\n`)
    for (var col of r.columns) {
      if (col.comment) {
        out.write(`  /**\n`)
        out.write(col.comment.split('\n').map(c => `   * ${c}`).join('\n'))
        out.write(`\n   */\n`)
      }
      out.write(`  ${col.column_name}: `)
      // console.log(col.udt_name)
      out.write(handle_udt_name(col.udt_name))
      if (col.is_nullable === 'YES')
        out.write(' | null = null')
      out.write('\n')
    }
    console.log('}\n\n')
  }

  const functions = await c.query(`
    SELECT

      fun.routine_name as name,
      fun.type_udt_name as returns,
      COALESCE(JSON_AGG(param ORDER BY ordinal_position) FILTER (WHERE param.parameter_name IS NOT NULL), '[]') as params

    FROM information_schema.routines fun
      LEFT JOIN information_schema.parameters param ON
        param.specific_schema = fun.specific_schema
        AND param.specific_catalog = fun.specific_catalog
        AND param.specific_name = fun.specific_name
    WHERE fun.specific_schema = $1
    GROUP BY fun.routine_name, fun.type_udt_name
  `, [SCHEMA])

  const frows = functions.rows as {name: string, returns: string, params: Parameter[]}[]
  // log(frows)

  for (var f of frows) {
    // Ignore triggers
    if (f.returns === 'trigger') continue

    out.write(`export function ${f.name}(`)
    var params = f.params
      .map(p => `${p.parameter_name}: ${handle_udt_name(p.udt_name)}`)
    out.write(params.join(', '))
    out.write(`): Promise<${handle_udt_name(f.returns)}> {\n`)
    out.write(`  return fetch('/pg/rpc/${f.name}', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({${f.params.map(f => f.parameter_name).join(', ')}})
  }).then(response => response.json())`)
    out.write('\n}\n\n')
  }

  // information_schema.routines
  // information_schema.parameters

  await c.end()
}

run().catch(e => console.error(e))