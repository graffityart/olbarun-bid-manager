import type {Credentials} from './credentials.ts';
export function connectionInfo(credentials:Credentials|null){
 return credentials?{customerId:credentials.NAVER_CUSTOMER_ID,apiKeySaved:!!credentials.NAVER_API_KEY,secretKeySaved:!!credentials.NAVER_SECRET_KEY}:null;
}
export function updatedCredentials(input:{customerId?:unknown;apiKey?:unknown;secretKey?:unknown},saved:Credentials|null):Credentials {
 const customerId=String(input.customerId??'').trim();const apiKey=String(input.apiKey??'').trim();const secretKey=String(input.secretKey??'').trim();
 if(saved&&customerId!==saved.NAVER_CUSTOMER_ID&&(!apiKey||!secretKey))throw Error('다른 Customer ID로 변경할 때는 액세스 라이선스와 비밀키도 입력하세요.');
 const result={NAVER_CUSTOMER_ID:customerId,NAVER_API_KEY:apiKey||saved?.NAVER_API_KEY||'',NAVER_SECRET_KEY:secretKey||saved?.NAVER_SECRET_KEY||''};
 if(!/^\d+$/.test(result.NAVER_CUSTOMER_ID)||!result.NAVER_API_KEY||!result.NAVER_SECRET_KEY||result.NAVER_API_KEY.length>1000||result.NAVER_SECRET_KEY.length>1000)throw Error('Customer ID와 API 정보를 확인하세요.');
 return result;
}
