import{e as y,c as r,ah as le,ai as ae,a as ne,b as M,f as q,d as te,aU as se,h as i,bm as ie,bn as de,u as ce,n as oe,bo as pe,l as X,aD as G,q as ue,aE as be,W as ge,r as N,X as he,Y as C,Z as l,$ as t,a0 as Y,a1 as Z,a2 as z,a3 as s,a4 as E,az as me,ac as j,P as fe,bp as ve,ay as H,Q as J,a5 as $,bc as ye,a6 as we,ab as V,aa as B}from"./index-C4MkC_gb.js";import{S as xe}from"./SearchOutlined-CTnLe-HT.js";import{D as Se}from"./DeleteOutlined-DsDhGPi7.js";import{N as Ce}from"./DataTable-OGMdJIwS.js";import{N as ze}from"./Select-CUBaVpzK.js";import{N as Q}from"./Code-qhHmCNSQ.js";function ee(d,m="default",g=[]){const{children:c}=d;if(c!==null&&typeof c=="object"&&!Array.isArray(c)){const p=c[m];if(typeof p=="function")return p()}return g}const ke=y([r("descriptions",{fontSize:"var(--n-font-size)"},[r("descriptions-separator",`
 display: inline-block;
 margin: 0 8px 0 2px;
 `),r("descriptions-table-wrapper",[r("descriptions-table",[r("descriptions-table-row",[r("descriptions-table-header",{padding:"var(--n-th-padding)"}),r("descriptions-table-content",{padding:"var(--n-td-padding)"})])])]),ne("bordered",[r("descriptions-table-wrapper",[r("descriptions-table",[r("descriptions-table-row",[y("&:last-child",[r("descriptions-table-content",{paddingBottom:0})])])])])]),M("left-label-placement",[r("descriptions-table-content",[y("> *",{verticalAlign:"top"})])]),M("left-label-align",[y("th",{textAlign:"left"})]),M("center-label-align",[y("th",{textAlign:"center"})]),M("right-label-align",[y("th",{textAlign:"right"})]),M("bordered",[r("descriptions-table-wrapper",`
 border-radius: var(--n-border-radius);
 overflow: hidden;
 background: var(--n-merged-td-color);
 border: 1px solid var(--n-merged-border-color);
 `,[r("descriptions-table",[r("descriptions-table-row",[y("&:not(:last-child)",[r("descriptions-table-content",{borderBottom:"1px solid var(--n-merged-border-color)"}),r("descriptions-table-header",{borderBottom:"1px solid var(--n-merged-border-color)"})]),r("descriptions-table-header",`
 font-weight: 400;
 background-clip: padding-box;
 background-color: var(--n-merged-th-color);
 `,[y("&:not(:last-child)",{borderRight:"1px solid var(--n-merged-border-color)"})]),r("descriptions-table-content",[y("&:not(:last-child)",{borderRight:"1px solid var(--n-merged-border-color)"})])])])])]),r("descriptions-header",`
 font-weight: var(--n-th-font-weight);
 font-size: 18px;
 transition: color .3s var(--n-bezier);
 line-height: var(--n-line-height);
 margin-bottom: 16px;
 color: var(--n-title-text-color);
 `),r("descriptions-table-wrapper",`
 transition:
 background-color .3s var(--n-bezier),
 border-color .3s var(--n-bezier);
 `,[r("descriptions-table",`
 width: 100%;
 border-collapse: separate;
 border-spacing: 0;
 box-sizing: border-box;
 `,[r("descriptions-table-row",`
 box-sizing: border-box;
 transition: border-color .3s var(--n-bezier);
 `,[r("descriptions-table-header",`
 font-weight: var(--n-th-font-weight);
 line-height: var(--n-line-height);
 display: table-cell;
 box-sizing: border-box;
 color: var(--n-th-text-color);
 transition:
 color .3s var(--n-bezier),
 background-color .3s var(--n-bezier),
 border-color .3s var(--n-bezier);
 `),r("descriptions-table-content",`
 vertical-align: top;
 line-height: var(--n-line-height);
 display: table-cell;
 box-sizing: border-box;
 color: var(--n-td-text-color);
 transition:
 color .3s var(--n-bezier),
 background-color .3s var(--n-bezier),
 border-color .3s var(--n-bezier);
 `,[q("content",`
 transition: color .3s var(--n-bezier);
 display: inline-block;
 color: var(--n-td-text-color);
 `)]),q("label",`
 font-weight: var(--n-th-font-weight);
 transition: color .3s var(--n-bezier);
 display: inline-block;
 margin-right: 14px;
 color: var(--n-th-text-color);
 `)])])])]),r("descriptions-table-wrapper",`
 --n-merged-th-color: var(--n-th-color);
 --n-merged-td-color: var(--n-td-color);
 --n-merged-border-color: var(--n-border-color);
 `),le(r("descriptions-table-wrapper",`
 --n-merged-th-color: var(--n-th-color-modal);
 --n-merged-td-color: var(--n-td-color-modal);
 --n-merged-border-color: var(--n-border-color-modal);
 `)),ae(r("descriptions-table-wrapper",`
 --n-merged-th-color: var(--n-th-color-popover);
 --n-merged-td-color: var(--n-td-color-popover);
 --n-merged-border-color: var(--n-border-color-popover);
 `))]),re="DESCRIPTION_ITEM_FLAG";function _e(d){return typeof d=="object"&&d&&!Array.isArray(d)?d.type&&d.type[re]:!1}const Ne=Object.assign(Object.assign({},oe.props),{title:String,column:{type:Number,default:3},columns:Number,labelPlacement:{type:String,default:"top"},labelAlign:{type:String,default:"left"},separator:{type:String,default:":"},size:{type:String,default:"medium"},bordered:Boolean,labelClass:String,labelStyle:[Object,String],contentClass:String,contentStyle:[Object,String]}),$e=te({name:"Descriptions",props:Ne,slots:Object,setup(d){const{mergedClsPrefixRef:m,inlineThemeDisabled:g}=ce(d),c=oe("Descriptions","-descriptions",ke,pe,d,m),p=X(()=>{const{size:h,bordered:a}=d,{common:{cubicBezierEaseInOut:w},self:{titleTextColor:k,thColor:x,thColorModal:n,thColorPopover:P,thTextColor:S,thFontWeight:_,tdTextColor:e,tdColor:b,tdColorModal:f,tdColorPopover:o,borderColor:R,borderColorModal:U,borderColorPopover:v,borderRadius:D,lineHeight:O,[G("fontSize",h)]:T,[G(a?"thPaddingBordered":"thPadding",h)]:I,[G(a?"tdPaddingBordered":"tdPadding",h)]:A}}=c.value;return{"--n-title-text-color":k,"--n-th-padding":I,"--n-td-padding":A,"--n-font-size":T,"--n-bezier":w,"--n-th-font-weight":_,"--n-line-height":O,"--n-th-text-color":S,"--n-td-text-color":e,"--n-th-color":x,"--n-th-color-modal":n,"--n-th-color-popover":P,"--n-td-color":b,"--n-td-color-modal":f,"--n-td-color-popover":o,"--n-border-radius":D,"--n-border-color":R,"--n-border-color-modal":U,"--n-border-color-popover":v}}),u=g?ue("descriptions",X(()=>{let h="";const{size:a,bordered:w}=d;return w&&(h+="a"),h+=a[0],h}),p,d):void 0;return{mergedClsPrefix:m,cssVars:g?void 0:p,themeClass:u?.themeClass,onRender:u?.onRender,compitableColumn:be(d,["columns","column"]),inlineThemeDisabled:g}},render(){const d=this.$slots.default,m=d?se(d()):[];m.length;const{contentClass:g,labelClass:c,compitableColumn:p,labelPlacement:u,labelAlign:h,size:a,bordered:w,title:k,cssVars:x,mergedClsPrefix:n,separator:P,onRender:S}=this;S?.();const _=m.filter(o=>_e(o)),e={span:0,row:[],secondRow:[],rows:[]},f=_.reduce((o,R,U)=>{const v=R.props||{},D=_.length-1===U,O=["label"in v?v.label:ee(R,"label")],T=[ee(R)],I=v.span||1,A=o.span;o.span+=I;const F=v.labelStyle||v["label-style"]||this.labelStyle,K=v.contentStyle||v["content-style"]||this.contentStyle;if(u==="left")w?o.row.push(i("th",{class:[`${n}-descriptions-table-header`,c],colspan:1,style:F},O),i("td",{class:[`${n}-descriptions-table-content`,g],colspan:D?(p-A)*2+1:I*2-1,style:K},T)):o.row.push(i("td",{class:`${n}-descriptions-table-content`,colspan:D?(p-A)*2:I*2},i("span",{class:[`${n}-descriptions-table-content__label`,c],style:F},[...O,P&&i("span",{class:`${n}-descriptions-separator`},P)]),i("span",{class:[`${n}-descriptions-table-content__content`,g],style:K},T)));else{const W=D?(p-A)*2:I*2;o.row.push(i("th",{class:[`${n}-descriptions-table-header`,c],colspan:W,style:F},O)),o.secondRow.push(i("td",{class:[`${n}-descriptions-table-content`,g],colspan:W,style:K},T))}return(o.span>=p||D)&&(o.span=0,o.row.length&&(o.rows.push(o.row),o.row=[]),u!=="left"&&o.secondRow.length&&(o.rows.push(o.secondRow),o.secondRow=[])),o},e).rows.map(o=>i("tr",{class:`${n}-descriptions-table-row`},o));return i("div",{style:x,class:[`${n}-descriptions`,this.themeClass,`${n}-descriptions--${u}-label-placement`,`${n}-descriptions--${h}-label-align`,`${n}-descriptions--${a}-size`,w&&`${n}-descriptions--bordered`]},k||this.$slots.header?i("div",{class:`${n}-descriptions-header`},k||de(this,"header")):null,i("div",{class:`${n}-descriptions-table-wrapper`},i("table",{class:`${n}-descriptions-table`},i("tbody",null,u==="top"&&i("tr",{class:`${n}-descriptions-table-row`,style:{visibility:"collapse"}},ie(p*2,i("td",null))),f))))}}),Pe={label:String,span:{type:Number,default:1},labelClass:String,labelStyle:[Object,String],contentClass:String,contentStyle:[Object,String]},L=te({name:"DescriptionsItem",[re]:!0,props:Pe,slots:Object,render(){return null}}),Me={__name:"ToolLogs",setup(d){const m=ge(),g=N(!1),c=N([]),p=N(""),u=N(null),h=N(!1),a=N(null),w=[{title:"时间",key:"timestamp",width:160,render:e=>S(e.timestamp)},{title:"工具",key:"toolName",width:180,render:e=>i(V,{type:"info",size:"small"},()=>e.toolName)},{title:"用户",key:"userId",width:120,ellipsis:{tooltip:!0}},{title:"状态",key:"success",width:80,render:e=>i(V,{type:e.success?"success":"error",size:"small"},()=>e.success?"成功":"失败")},{title:"耗时",key:"duration",width:80,render:e=>e.duration?`${e.duration}ms`:"-"},{title:"操作",key:"actions",width:80,render:e=>i(J,{size:"small",onClick:()=>n(e)},()=>"详情")}],k=N([]);async function x(){g.value=!0;try{const e={};u.value&&(e.tool=u.value),p.value&&(e.search=p.value);const b=await Z.get("/api/tools/logs",{params:e});if(b.data.code===0){c.value=b.data.data||[];const f=new Set(c.value.map(o=>o.toolName));k.value=Array.from(f).map(o=>({label:o,value:o}))}}catch(e){m.error("获取日志失败: "+e.message)}finally{g.value=!1}}function n(e){a.value=e,h.value=!0}async function P(){try{(await Z.delete("/api/tools/logs")).data.code===0&&(m.success("日志已清空"),c.value=[])}catch(e){m.error("清空失败: "+e.message)}}function S(e){return e?new Date(e).toLocaleString("zh-CN"):"-"}function _(e){try{return JSON.stringify(e,null,2)}catch{return String(e)}}return he(()=>{x()}),(e,b)=>(z(),C(t(Y),{vertical:"",size:"large"},{default:l(()=>[s(t(E),{title:"工具调用日志"},{"header-extra":l(()=>[s(t(Y),null,{default:l(()=>[s(t(ze),{value:u.value,"onUpdate:value":[b[0]||(b[0]=f=>u.value=f),x],options:k.value,placeholder:"筛选工具",clearable:"",style:{width:"180px"}},null,8,["value","options"]),s(t(fe),{value:p.value,"onUpdate:value":b[1]||(b[1]=f=>p.value=f),placeholder:"搜索...",clearable:"",style:{width:"150px"},onKeyup:ve(x,["enter"])},{prefix:l(()=>[s(t(H),null,{default:l(()=>[s(t(xe))]),_:1})]),_:1},8,["value"]),s(t(J),{onClick:x,loading:g.value},{icon:l(()=>[s(t(H),null,{default:l(()=>[s(t(ye))]),_:1})]),default:l(()=>[b[3]||(b[3]=$(" 刷新 ",-1))]),_:1},8,["loading"]),c.value.length>0?(z(),C(t(J),{key:0,type:"error",onClick:P},{icon:l(()=>[s(t(H),null,{default:l(()=>[s(t(Se))]),_:1})]),default:l(()=>[b[4]||(b[4]=$(" 清空 ",-1))]),_:1})):j("",!0)]),_:1})]),default:l(()=>[c.value.length===0?(z(),C(t(me),{key:0,description:"暂无日志记录"})):(z(),C(t(Ce),{key:1,columns:w,data:c.value,loading:g.value,pagination:{pageSize:50},bordered:!1,striped:"","max-height":"60vh"},null,8,["data","loading"]))]),_:1}),s(t(we),{show:h.value,"onUpdate:show":b[2]||(b[2]=f=>h.value=f),preset:"card",title:"调用详情",style:{width:"700px"}},{default:l(()=>[a.value?(z(),C(t($e),{key:0,column:2,"label-placement":"left",bordered:""},{default:l(()=>[s(t(L),{label:"工具名称"},{default:l(()=>[s(t(V),{type:"info"},{default:l(()=>[$(B(a.value.toolName),1)]),_:1})]),_:1}),s(t(L),{label:"状态"},{default:l(()=>[s(t(V),{type:a.value.success?"success":"error"},{default:l(()=>[$(B(a.value.success?"成功":"失败"),1)]),_:1},8,["type"])]),_:1}),s(t(L),{label:"用户ID"},{default:l(()=>[$(B(a.value.userId||"-"),1)]),_:1}),s(t(L),{label:"耗时"},{default:l(()=>[$(B(a.value.duration?a.value.duration+"ms":"-"),1)]),_:1}),s(t(L),{label:"时间",span:2},{default:l(()=>[$(B(S(a.value.timestamp)),1)]),_:1})]),_:1})):j("",!0),a.value?.arguments?(z(),C(t(E),{key:1,title:"请求参数",size:"small",style:{"margin-top":"16px"}},{default:l(()=>[s(t(Q),{code:_(a.value.arguments),language:"json"},null,8,["code"])]),_:1})):j("",!0),a.value?.result?(z(),C(t(E),{key:2,title:"返回结果",size:"small",style:{"margin-top":"16px"}},{default:l(()=>[s(t(Q),{code:_(a.value.result),language:"json",style:{"max-height":"300px",overflow:"auto"}},null,8,["code"])]),_:1})):j("",!0),a.value?.error?(z(),C(t(E),{key:3,title:"错误信息",size:"small",style:{"margin-top":"16px"}},{default:l(()=>[s(t(Q),{code:a.value.error,language:"text"},null,8,["code"])]),_:1})):j("",!0)]),_:1},8,["show"])]),_:1}))}};export{Me as default};
