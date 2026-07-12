export type Status='online'|'offline'|'connected'|'disconnected'|'active'|'paused'|'maintenance'|'warning'|'error'|'critical';
export type SourceType='rss'|'atom'|'website'|'sitemap'|'listing'|'press'|'json'|'manual';
export type ArticleStatus='draft'|'auto_created'|'review'|'approved'|'sent'|'corrected'|'withdrawn'|'blocked'|'archived';
export interface Source{id:string;name:string;url:string;domain:string;type:SourceType;category:string;region:string;language:string;priority:number;trustLevel:number;fetchIntervalSeconds:number;active:boolean;selectors?:Record<string,string>}
export interface Article{id:string;sourceId:string;title:string;url:string;canonicalUrl?:string;publishedAt?:string;fetchedAt:string;author?:string;excerpt:string;contentHash:string;summary?:string;script?:string;category?:string;region?:string;tags:string[];status:ArticleStatus;trustScore:number;warnings:string[]}
export interface OverlayElement{id:string;type:string;name:string;x:number;y:number;width:number;height:number;rotation:number;opacity:number;zIndex:number;locked:boolean;hidden:boolean;props:Record<string,unknown>;binding?:string;animation?:Record<string,unknown>}
export interface OverlayProject{id:string;name:string;width:number;height:number;elements:OverlayElement[];version:number;published:boolean}
export interface BroadcastItem{id:string;type:'article'|'jingle'|'scene'|'break'|'maintenance';title:string;durationSeconds:number;articleId?:string;sceneId?:string;status:'planned'|'running'|'done'|'skipped'|'locked';locked?:boolean}
