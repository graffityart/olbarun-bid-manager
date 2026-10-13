import {Pool} from "pg";import {attachDatabasePool} from "@vercel/functions";
let pool:Pool|undefined;
function getPool(){if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL 설정이 필요합니다.");if(!pool){pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,idleTimeoutMillis:5000,connectionTimeoutMillis:10000});attachDatabasePool(pool)}return pool}
export function database(){return {prepare(query:string){let values:unknown[]=[];let i=0;const sql=query.replace(/\?/g,()=>`$${++i}`);return {bind(...args:unknown[]){values=args;return this},async first(){return (await getPool().query(sql,values)).rows[0]??null},async all(){return {results:(await getPool().query(sql,values)).rows}},async run(){return getPool().query(sql,values)}}}}}

export async function withManagementLock<T>(fn:(db:ReturnType<typeof database>)=>Promise<T>):Promise<T>{
 const client=await getPool().connect();
 try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(704031028)');
 const tx={prepare(query:string){let values:unknown[]=[];let i=0;const sql=query.replace(/\?/g,()=>`$${++i}`);return {bind(...args:unknown[]){values=args;return this},async first(){return (await client.query(sql,values)).rows[0]??null},async all(){return {results:(await client.query(sql,values)).rows}},async run(){return client.query(sql,values)}}}};
 const result=await fn(tx);await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
