import {Pool} from "pg";import {attachDatabasePool} from "@vercel/functions";
let pool:Pool|undefined;
function getPool(){if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL 설정이 필요합니다.");if(!pool){pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,idleTimeoutMillis:5000,connectionTimeoutMillis:10000});attachDatabasePool(pool)}return pool}
export function database(){return {prepare(query:string){let values:unknown[]=[];let i=0;const sql=query.replace(/\?/g,()=>`$${++i}`);return {bind(...args:unknown[]){values=args;return this},async first(){return (await getPool().query(sql,values)).rows[0]??null},async all(){return {results:(await getPool().query(sql,values)).rows}},async run(){return getPool().query(sql,values)}}}}}
