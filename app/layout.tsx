import type {Metadata} from "next";import "./globals.css";
export const metadata:Metadata={title:"올바른 입찰관리",description:"개인용 네이버 파워링크 입찰 관리",icons:{icon:"/favicon.svg"}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>}
