import {Pool} from "pg";import {readFile} from "node:fs/promises";
const url=process.env.DATABASE_URL_UNPOOLED;if(!url)throw Error("DATABASE_URL_UNPOOLED is required for migrations");const pool=new Pool({connectionString:url,max:1});try{await pool.query(await readFile(new URL("../migrations/001_initial.sql",import.meta.url),"utf8"));console.log("Migration complete")}finally{await pool.end()}
