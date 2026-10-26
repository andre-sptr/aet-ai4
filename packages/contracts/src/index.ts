import { z } from 'zod';

const safeUrl = z.string().max(2048).refine(value=>{
  try {const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password;} catch {return false;}
}, 'Gunakan URL HTTP atau HTTPS yang valid.');
const nullableText = (length:number)=>z.string().trim().max(length).nullable().default(null);
const date = z.iso.datetime({offset:true});
export const NewsInputSchema=z.object({
  title:z.string().trim().min(1).max(240),
  slug:z.string().min(1).max(240).regex(/^[a-z0-9]+(?:-+[a-z0-9]+)*$/),
  content:z.string().trim().min(1).max(100000), summary:nullableText(1000),
  imageUrl:safeUrl.nullable().default(null),published:z.boolean().default(false),
}).strict();
export const EventInputSchema=z.object({
  title:z.string().trim().min(1).max(240),description:z.string().trim().min(1).max(50000),
  location:nullableText(500),startDate:date,endDate:date.nullable().default(null),
  imageUrl:safeUrl.nullable().default(null),published:z.boolean().default(true),
}).strict();
export const TeamMemberInputSchema=z.object({
  name:z.string().trim().min(1).max(200),position:z.string().trim().min(1).max(200),
  bio:nullableText(10000),photoUrl:safeUrl.nullable().default(null),order:z.number().int().min(0).max(10000).default(0),
  socials:z.record(z.string().max(40),safeUrl).nullable().default(null),
}).strict();
export const LoginSchema=z.object({username:z.string().trim().min(1).max(100),password:z.string().min(1).max(256)}).strict();
const identityFields={id:z.string().min(1),createdAt:date,updatedAt:date};
export const NewsSchema=NewsInputSchema.extend(identityFields);
export const EventSchema=EventInputSchema.extend(identityFields);
export const TeamMemberSchema=TeamMemberInputSchema.extend(identityFields);
export type NewsInput=z.infer<typeof NewsInputSchema>;
export type EventInput=z.infer<typeof EventInputSchema>;
export type TeamMemberInput=z.infer<typeof TeamMemberInputSchema>;
export type News=NewsInput&{id:string;createdAt:string;updatedAt:string};
export type Event=EventInput&{id:string;createdAt:string;updatedAt:string};
export type TeamMember=TeamMemberInput&{id:string;createdAt:string;updatedAt:string};
export const personaSchema=z.enum(['daily','report','coding']);
export const effortSchema=z.enum(['fast','normal','think']);
export const attachmentSchema=z.object({
  id:z.string().min(1).max(100),name:z.string().min(1).max(255),
  mimeType:z.enum(['image/jpeg','image/png','image/webp','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain']),
  size:z.number().int().positive().max(8*1024*1024),
  text:z.string().max(80000).optional(),
  dataUrl:z.string().max(8*1024*1024).regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/).optional(),
}).strict();
export const chatMessageSchema=z.object({
  id:z.string().max(100).optional(),role:z.enum(['user','assistant']),content:z.string().max(24000),
  attachments:z.array(attachmentSchema).max(4).optional(),
}).strict();
export const chatRequestSchema=z.object({
  persona:personaSchema,effort:effortSchema.default('normal'),messages:z.array(chatMessageSchema).min(1).max(60),
}).strict().superRefine((request,context)=>{
  if(request.messages.at(-1)?.role!=='user')context.addIssue({code:'custom',message:'Pesan terakhir harus berasal dari pengguna.'});
  if(request.messages.reduce((sum,item)=>sum+item.content.length+(item.attachments??[]).reduce((n,a)=>n+(a.text?.length??0),0),0)>160000)
    context.addIssue({code:'custom',message:'Konteks percakapan terlalu panjang.'});
});
export const modelTestSchema=z.object({modelId:z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),prompt:z.string().trim().min(1).max(4000)}).strict();
export type Persona=z.infer<typeof personaSchema>;
export type Effort=z.infer<typeof effortSchema>;
export type Attachment=z.infer<typeof attachmentSchema>;
export type ChatMessage=z.infer<typeof chatMessageSchema>;
export type ChatRequest=z.infer<typeof chatRequestSchema>;
export type Source={id?:string;title:string;url:string};
export type ChatFrame=
  |{event:'status';data:{message:string}}
  |{event:'delta';data:{text:string}}
  |{event:'metadata';data:{model:string;strategy:string;[key:string]:unknown}}
  |{event:'tool';data:{name:string;status:string;summary?:string}}
  |{event:'sources';data:{sources:Source[]}}
  |{event:'done';data:{status:'complete';requestId:string}}
  |{event:'error';data:{code:string;message:string}}
  |{event:'cancelled';data:{message?:string}};
export type ApiError={error:{code:string;message:string}};
export const newsInputSchema=NewsInputSchema;
export const eventInputSchema=EventInputSchema;
export const teamMemberInputSchema=TeamMemberInputSchema;
