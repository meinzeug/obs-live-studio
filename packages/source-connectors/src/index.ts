export interface ConnectorResult{url:string;contentType:string;body:string;etag?:string;lastModified?:string}
export function nextFetchAt(intervalSeconds:number,from=new Date()){return new Date(from.getTime()+intervalSeconds*1000).toISOString();}
