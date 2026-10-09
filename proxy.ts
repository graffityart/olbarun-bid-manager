import {NextRequest,NextResponse} from "next/server";import {validSession} from "@/lib/session";
export async function proxy(req:NextRequest){if(req.nextUrl.pathname==="/login"||req.nextUrl.pathname==="/api/login")return NextResponse.next();if(await validSession(req.cookies.get("bid_session")?.value))return NextResponse.next();if(req.nextUrl.pathname.startsWith("/api/"))return NextResponse.json({error:"로그인이 필요합니다."},{status:401});return NextResponse.redirect(new URL("/login",req.url))}
export const config={matcher:["/((?!_next/static|_next/image|favicon.svg).*)"]};
