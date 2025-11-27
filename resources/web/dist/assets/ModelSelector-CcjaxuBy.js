import{d as S,h,c as z,b as g,e as G,f as m,a as L,aB as ce,u as V,w as U,A as _,y as ue,z as E,aC as pe,i as ae,C as H,q as fe,p as he,I as T,aD as me,aE as ve,aF as ge,x as re,aG as xe,v as q,aH as be,G as we,am as Ce,s as ye,aI as ke,aJ as W,H as ze,aK as Ne,aL as F,aM as _e,aN as $e,ay as Se,aO as Re,aP as O,ac as N,aj as K,a5 as Ie,a0 as Q,a8 as A,a9 as v,ad as x,aQ as J,aa as f,O as I,M as Z,af as M,ak as P,aR as X,N as Me,B as Y,aS as ee,al as Pe}from"./index-DXh3Z4_f.js";import{N as Ee,a as te}from"./Checkbox-C_x1OZs5.js";const Ae=S({name:"ChevronLeft",render(){return h("svg",{viewBox:"0 0 16 16",fill:"none",xmlns:"http://www.w3.org/2000/svg"},h("path",{d:"M10.3536 3.14645C10.5488 3.34171 10.5488 3.65829 10.3536 3.85355L6.20711 8L10.3536 12.1464C10.5488 12.3417 10.5488 12.6583 10.3536 12.8536C10.1583 13.0488 9.84171 13.0488 9.64645 12.8536L5.14645 8.35355C4.95118 8.15829 4.95118 7.84171 5.14645 7.64645L9.64645 3.14645C9.84171 2.95118 10.1583 2.95118 10.3536 3.14645Z",fill:"currentColor"}))}}),Be=z("collapse","width: 100%;",[z("collapse-item",`
 font-size: var(--n-font-size);
 color: var(--n-text-color);
 transition:
 color .3s var(--n-bezier),
 border-color .3s var(--n-bezier);
 margin: var(--n-item-margin);
 `,[g("disabled",[m("header","cursor: not-allowed;",[m("header-main",`
 color: var(--n-title-text-color-disabled);
 `),z("collapse-item-arrow",`
 color: var(--n-arrow-color-disabled);
 `)])]),z("collapse-item","margin-left: 32px;"),G("&:first-child","margin-top: 0;"),G("&:first-child >",[m("header","padding-top: 0;")]),g("left-arrow-placement",[m("header",[z("collapse-item-arrow","margin-right: 4px;")])]),g("right-arrow-placement",[m("header",[z("collapse-item-arrow","margin-left: 4px;")])]),m("content-wrapper",[m("content-inner","padding-top: 16px;"),ce({duration:"0.15s"})]),g("active",[m("header",[g("active",[z("collapse-item-arrow","transform: rotate(90deg);")])])]),G("&:not(:first-child)","border-top: 1px solid var(--n-divider-color);"),L("disabled",[g("trigger-area-main",[m("header",[m("header-main","cursor: pointer;"),z("collapse-item-arrow","cursor: default;")])]),g("trigger-area-arrow",[m("header",[z("collapse-item-arrow","cursor: pointer;")])]),g("trigger-area-extra",[m("header",[m("header-extra","cursor: pointer;")])])]),m("header",`
 font-size: var(--n-title-font-size);
 display: flex;
 flex-wrap: nowrap;
 align-items: center;
 transition: color .3s var(--n-bezier);
 position: relative;
 padding: var(--n-title-padding);
 color: var(--n-title-text-color);
 `,[m("header-main",`
 display: flex;
 flex-wrap: nowrap;
 align-items: center;
 font-weight: var(--n-title-font-weight);
 transition: color .3s var(--n-bezier);
 flex: 1;
 color: var(--n-title-text-color);
 `),m("header-extra",`
 display: flex;
 align-items: center;
 transition: color .3s var(--n-bezier);
 color: var(--n-text-color);
 `),z("collapse-item-arrow",`
 display: flex;
 transition:
 transform .15s var(--n-bezier),
 color .3s var(--n-bezier);
 font-size: 18px;
 color: var(--n-arrow-color);
 `)])])]),De=Object.assign(Object.assign({},E.props),{defaultExpandedNames:{type:[Array,String],default:null},expandedNames:[Array,String],arrowPlacement:{type:String,default:"left"},accordion:{type:Boolean,default:!1},displayDirective:{type:String,default:"if"},triggerAreas:{type:Array,default:()=>["main","extra","arrow"]},onItemHeaderClick:[Function,Array],"onUpdate:expandedNames":[Function,Array],onUpdateExpandedNames:[Function,Array],onExpandedNamesChange:{type:[Function,Array],validator:()=>!0,default:void 0}}),ie=fe("n-collapse"),Te=S({name:"Collapse",props:De,slots:Object,setup(t,{slots:d}){const{mergedClsPrefixRef:r,inlineThemeDisabled:o,mergedRtlRef:u}=V(t),e=U(t.defaultExpandedNames),c=_(()=>t.expandedNames),w=ue(c,e),C=E("Collapse","-collapse",Be,pe,t,r);function b(s){const{"onUpdate:expandedNames":i,onUpdateExpandedNames:l,onExpandedNamesChange:n}=t;l&&T(l,s),i&&T(i,s),n&&T(n,s),e.value=s}function k(s){const{onItemHeaderClick:i}=t;i&&T(i,s)}function p(s,i,l){const{accordion:n}=t,{value:B}=w;if(n)s?(b([i]),k({name:i,expanded:!0,event:l})):(b([]),k({name:i,expanded:!1,event:l}));else if(!Array.isArray(B))b([i]),k({name:i,expanded:!0,event:l});else{const R=B.slice(),D=R.findIndex(j=>i===j);~D?(R.splice(D,1),b(R),k({name:i,expanded:!1,event:l})):(R.push(i),b(R),k({name:i,expanded:!0,event:l}))}}he(ie,{props:t,mergedClsPrefixRef:r,expandedNamesRef:w,slots:d,toggleItem:p});const y=ae("Collapse",u,r),$=_(()=>{const{common:{cubicBezierEaseInOut:s},self:{titleFontWeight:i,dividerColor:l,titlePadding:n,titleTextColor:B,titleTextColorDisabled:R,textColor:D,arrowColor:j,fontSize:ne,titleFontSize:se,arrowColorDisabled:oe,itemMargin:de}}=C.value;return{"--n-font-size":ne,"--n-bezier":s,"--n-text-color":D,"--n-divider-color":l,"--n-title-padding":n,"--n-title-font-size":se,"--n-title-text-color":B,"--n-title-text-color-disabled":R,"--n-title-font-weight":i,"--n-arrow-color":j,"--n-arrow-color-disabled":oe,"--n-item-margin":de}}),a=o?H("collapse",void 0,$,t):void 0;return{rtlEnabled:y,mergedTheme:C,mergedClsPrefix:r,cssVars:o?void 0:$,themeClass:a?.themeClass,onRender:a?.onRender}},render(){var t;return(t=this.onRender)===null||t===void 0||t.call(this),h("div",{class:[`${this.mergedClsPrefix}-collapse`,this.rtlEnabled&&`${this.mergedClsPrefix}-collapse--rtl`,this.themeClass],style:this.cssVars},this.$slots)}}),Le=S({name:"CollapseItemContent",props:{displayDirective:{type:String,required:!0},show:Boolean,clsPrefix:{type:String,required:!0}},setup(t){return{onceTrue:ge(re(t,"show"))}},render(){return h(me,null,{default:()=>{const{show:t,displayDirective:d,onceTrue:r,clsPrefix:o}=this,u=d==="show"&&r,e=h("div",{class:`${o}-collapse-item__content-wrapper`},h("div",{class:`${o}-collapse-item__content-inner`},this.$slots));return u?ve(e,[[xe,t]]):t?e:null}})}}),Oe={title:String,name:[String,Number],disabled:Boolean,displayDirective:String},Ve=S({name:"CollapseItem",props:Oe,setup(t){const{mergedRtlRef:d}=V(t),r=we(),o=Ce(()=>{var p;return(p=t.name)!==null&&p!==void 0?p:r}),u=ye(ie);u||ke("collapse-item","`n-collapse-item` must be placed inside `n-collapse`.");const{expandedNamesRef:e,props:c,mergedClsPrefixRef:w,slots:C}=u,b=_(()=>{const{value:p}=e;if(Array.isArray(p)){const{value:y}=o;return!~p.findIndex($=>$===y)}else if(p){const{value:y}=o;return y!==p}return!0});return{rtlEnabled:ae("Collapse",d,w),collapseSlots:C,randomName:r,mergedClsPrefix:w,collapsed:b,triggerAreas:re(c,"triggerAreas"),mergedDisplayDirective:_(()=>{const{displayDirective:p}=t;return p||c.displayDirective}),arrowPlacement:_(()=>c.arrowPlacement),handleClick(p){let y="main";W(p,"arrow")&&(y="arrow"),W(p,"extra")&&(y="extra"),c.triggerAreas.includes(y)&&u&&!t.disabled&&u.toggleItem(b.value,o.value,p)}}},render(){const{collapseSlots:t,$slots:d,arrowPlacement:r,collapsed:o,mergedDisplayDirective:u,mergedClsPrefix:e,disabled:c,triggerAreas:w}=this,C=q(d.header,{collapsed:o},()=>[this.title]),b=d["header-extra"]||t["header-extra"],k=d.arrow||t.arrow;return h("div",{class:[`${e}-collapse-item`,`${e}-collapse-item--${r}-arrow-placement`,c&&`${e}-collapse-item--disabled`,!o&&`${e}-collapse-item--active`,w.map(p=>`${e}-collapse-item--trigger-area-${p}`)]},h("div",{class:[`${e}-collapse-item__header`,!o&&`${e}-collapse-item__header--active`]},h("div",{class:`${e}-collapse-item__header-main`,onClick:this.handleClick},r==="right"&&C,h("div",{class:`${e}-collapse-item-arrow`,key:this.rtlEnabled?0:1,"data-arrow":!0},q(k,{collapsed:o},()=>[h(ze,{clsPrefix:e},{default:()=>this.rtlEnabled?h(Ae,null):h(Ne,null)})])),r==="left"&&C),be(b,{collapsed:o},p=>h("div",{class:`${e}-collapse-item__header-extra`,onClick:this.handleClick,"data-extra":!0},p))),h(Le,{clsPrefix:e,displayDirective:u,show:!o},d))}}),je=z("divider",`
 position: relative;
 display: flex;
 width: 100%;
 box-sizing: border-box;
 font-size: 16px;
 color: var(--n-text-color);
 transition:
 color .3s var(--n-bezier),
 background-color .3s var(--n-bezier);
`,[L("vertical",`
 margin-top: 24px;
 margin-bottom: 24px;
 `,[L("no-title",`
 display: flex;
 align-items: center;
 `)]),m("title",`
 display: flex;
 align-items: center;
 margin-left: 12px;
 margin-right: 12px;
 white-space: nowrap;
 font-weight: var(--n-font-weight);
 `),g("title-position-left",[m("line",[g("left",{width:"28px"})])]),g("title-position-right",[m("line",[g("right",{width:"28px"})])]),g("dashed",[m("line",`
 background-color: #0000;
 height: 0px;
 width: 100%;
 border-style: dashed;
 border-width: 1px 0 0;
 `)]),g("vertical",`
 display: inline-block;
 height: 1em;
 margin: 0 8px;
 vertical-align: middle;
 width: 1px;
 `),m("line",`
 border: none;
 transition: background-color .3s var(--n-bezier), border-color .3s var(--n-bezier);
 height: 1px;
 width: 100%;
 margin: 0;
 `),L("dashed",[m("line",{backgroundColor:"var(--n-color)"})]),g("dashed",[m("line",{borderColor:"var(--n-color)"})]),g("vertical",{backgroundColor:"var(--n-color)"})]),Ge=Object.assign(Object.assign({},E.props),{titlePlacement:{type:String,default:"center"},dashed:Boolean,vertical:Boolean}),Ue=S({name:"Divider",props:Ge,setup(t){const{mergedClsPrefixRef:d,inlineThemeDisabled:r}=V(t),o=E("Divider","-divider",je,_e,t,d),u=_(()=>{const{common:{cubicBezierEaseInOut:c},self:{color:w,textColor:C,fontWeight:b}}=o.value;return{"--n-bezier":c,"--n-color":w,"--n-text-color":C,"--n-font-weight":b}}),e=r?H("divider",void 0,u,t):void 0;return{mergedClsPrefix:d,cssVars:r?void 0:u,themeClass:e?.themeClass,onRender:e?.onRender}},render(){var t;const{$slots:d,titlePlacement:r,vertical:o,dashed:u,cssVars:e,mergedClsPrefix:c}=this;return(t=this.onRender)===null||t===void 0||t.call(this),h("div",{role:"separator",class:[`${c}-divider`,this.themeClass,{[`${c}-divider--vertical`]:o,[`${c}-divider--no-title`]:!d.default,[`${c}-divider--dashed`]:u,[`${c}-divider--title-position-${r}`]:d.default&&r}],style:e},o?null:h("div",{class:`${c}-divider__line ${c}-divider__line--left`}),!o&&d.default?h(F,null,h("div",{class:`${c}-divider__title`},this.$slots),h("div",{class:`${c}-divider__line ${c}-divider__line--right`})):null)}}),Fe=z("text",`
 transition: color .3s var(--n-bezier);
 color: var(--n-text-color);
`,[g("strong",`
 font-weight: var(--n-font-weight-strong);
 `),g("italic",{fontStyle:"italic"}),g("underline",{textDecoration:"underline"}),g("code",`
 line-height: 1.4;
 display: inline-block;
 font-family: var(--n-font-famliy-mono);
 transition: 
 color .3s var(--n-bezier),
 border-color .3s var(--n-bezier),
 background-color .3s var(--n-bezier);
 box-sizing: border-box;
 padding: .05em .35em 0 .35em;
 border-radius: var(--n-code-border-radius);
 font-size: .9em;
 color: var(--n-code-text-color);
 background-color: var(--n-code-color);
 border: var(--n-code-border);
 `)]),He=Object.assign(Object.assign({},E.props),{code:Boolean,type:{type:String,default:"default"},delete:Boolean,strong:Boolean,italic:Boolean,underline:Boolean,depth:[String,Number],tag:String,as:{type:String,validator:()=>!0,default:void 0}}),le=S({name:"Text",props:He,setup(t){const{mergedClsPrefixRef:d,inlineThemeDisabled:r}=V(t),o=E("Typography","-text",Fe,$e,t,d),u=_(()=>{const{depth:c,type:w}=t,C=w==="default"?c===void 0?"textColor":`textColor${c}Depth`:Se("textColor",w),{common:{fontWeightStrong:b,fontFamilyMono:k,cubicBezierEaseInOut:p},self:{codeTextColor:y,codeBorderRadius:$,codeColor:a,codeBorder:s,[C]:i}}=o.value;return{"--n-bezier":p,"--n-text-color":i,"--n-font-weight-strong":b,"--n-font-famliy-mono":k,"--n-code-border-radius":$,"--n-code-text-color":y,"--n-code-color":a,"--n-code-border":s}}),e=r?H("text",_(()=>`${t.type[0]}${t.depth||""}`),u,t):void 0;return{mergedClsPrefix:d,compitableTag:Re(t,["as","tag"]),cssVars:r?void 0:u,themeClass:e?.themeClass,onRender:e?.onRender}},render(){var t,d,r;const{mergedClsPrefix:o}=this;(t=this.onRender)===null||t===void 0||t.call(this);const u=[`${o}-text`,this.themeClass,{[`${o}-text--code`]:this.code,[`${o}-text--delete`]:this.delete,[`${o}-text--strong`]:this.strong,[`${o}-text--italic`]:this.italic,[`${o}-text--underline`]:this.underline}],e=(r=(d=this.$slots).default)===null||r===void 0?void 0:r.call(d);return this.code?h("code",{class:u,style:this.cssVars},this.delete?h("del",null,e):e):this.delete?h("del",{class:u,style:this.cssVars},e):h(this.compitableTag||"span",{class:u,style:this.cssVars},e)}}),Ke={xmlns:"http://www.w3.org/2000/svg","xmlns:xlink":"http://www.w3.org/1999/xlink",viewBox:"0 0 24 24"},qe=S({name:"CheckCircleOutlined",render:function(d,r){return N(),O("svg",Ke,r[0]||(r[0]=[K("path",{d:"M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8s8 3.59 8 8s-3.59 8-8 8zm4.59-12.42L10 14.17l-2.59-2.58L6 13l4 4l8-8z",fill:"currentColor"},null,-1)]))}}),We={xmlns:"http://www.w3.org/2000/svg","xmlns:xlink":"http://www.w3.org/1999/xlink",viewBox:"0 0 24 24"},Qe=S({name:"SearchOutlined",render:function(d,r){return N(),O("svg",We,r[0]||(r[0]=[K("path",{d:"M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5A6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5S14 7.01 14 9.5S11.99 14 9.5 14z",fill:"currentColor"},null,-1)]))}}),Je={style:{"max-height":"50vh","overflow-y":"auto","padding-right":"4px"}},Ze={__name:"ModelSelector",props:{value:{type:Array,default:()=>[]},allModels:{type:Array,default:()=>[]},multiple:{type:Boolean,default:!0}},emits:["update:value"],setup(t,{emit:d}){const r=t,o=d,u=U(""),e=U([...r.value]);Q(()=>r.value,a=>{e.value=[...a]}),Q(e,a=>{o("update:value",a)});const c=_(()=>{const a={零一万物:[],OpenAI:[],Claude:[],Gemini:[],DeepSeek:[],"智谱 (GLM)":[],"Qwen (通义千问)":[],"Doubao (豆包)":[],"Mistral AI":[],Llama:[],Grok:[],"Kimi (Moonshot)":[],MiniMax:[],Cohere:[],其他:[]},s=u.value.toLowerCase();return r.allModels.filter(l=>l.toLowerCase().includes(s)).forEach(l=>{const n=l.toLowerCase();n.includes("yi-")||n.includes("零一")?a.零一万物.push(l):n.includes("gpt")||n.includes("o1")||n.includes("o3")||n.includes("davinci")?a.OpenAI.push(l):n.includes("claude")?a.Claude.push(l):n.includes("gemini")||n.includes("gemma")?a.Gemini.push(l):n.includes("deepseek")?a.DeepSeek.push(l):n.includes("glm")||n.includes("智谱")?a["智谱 (GLM)"].push(l):n.includes("qwen")||n.includes("qwq")?a["Qwen (通义千问)"].push(l):n.includes("doubao")||n.includes("豆包")?a["Doubao (豆包)"].push(l):n.includes("mistral")?a["Mistral AI"].push(l):n.includes("llama")?a.Llama.push(l):n.includes("grok")?a.Grok.push(l):n.includes("kimi")||n.includes("moonshot")?a["Kimi (Moonshot)"].push(l):n.includes("minimax")||n.includes("abab")?a.MiniMax.push(l):n.includes("cohere")||n.includes("command")?a.Cohere.push(l):a.其他.push(l)}),Object.entries(a).filter(([l,n])=>n.length>0).map(([l,n])=>({name:l,models:n}))});function w(){e.value=[...r.allModels]}function C(){e.value=[]}function b(a){a.models.forEach(s=>{e.value.includes(s)||e.value.push(s)})}function k(a){e.value=e.value.filter(s=>!a.models.includes(s))}function p(a){return a.models.every(s=>e.value.includes(s))}function y(a){const s=a.models.filter(i=>e.value.includes(i)).length;return s>0&&s<a.models.length}function $(a){r.multiple||(e.value=[a])}return(a,s)=>(N(),A(f(I),{vertical:"",size:16},{default:v(()=>[x(f(I),{justify:"space-between",align:"center"},{default:v(()=>[x(f(I),{size:8},{default:v(()=>[x(f(Z),{type:"success",bordered:!1,size:"medium"},{icon:v(()=>[x(f(X),null,{default:v(()=>[x(f(qe))]),_:1})]),default:v(()=>[M(" 已选择 ("+P(e.value.length)+") ",1)]),_:1})]),_:1})]),_:1}),x(f(Me),{value:u.value,"onUpdate:value":s[0]||(s[0]=i=>u.value=i),placeholder:"搜索模型",clearable:"",size:"large"},{prefix:v(()=>[x(f(X),null,{default:v(()=>[x(f(Qe))]),_:1})]),_:1},8,["value"]),t.multiple?(N(),A(f(I),{key:0,justify:"space-between",align:"center"},{default:v(()=>[x(f(le),{depth:"3"},{default:v(()=>[M(" 已选择 "+P(e.value.length)+" / "+P(t.allModels.length),1)]),_:1}),x(f(I),{size:8},{default:v(()=>[x(f(Y),{size:"small",onClick:w},{default:v(()=>[...s[3]||(s[3]=[M("全选",-1)])]),_:1}),x(f(Y),{size:"small",onClick:C},{default:v(()=>[...s[4]||(s[4]=[M("取消全选",-1)])]),_:1})]),_:1})]),_:1})):J("",!0),x(f(Ue),{style:{margin:"0"}}),K("div",Je,[x(f(Te),{"arrow-placement":"right","default-expanded-names":c.value.map(i=>i.name)},{default:v(()=>[(N(!0),O(F,null,ee(c.value,i=>(N(),A(f(Ve),{key:i.name,name:i.name},{header:v(()=>[x(f(I),{align:"center",size:12},{default:v(()=>[t.multiple?(N(),A(f(te),{key:0,checked:p(i),indeterminate:y(i),"onUpdate:checked":l=>l?b(i):k(i),onClick:s[1]||(s[1]=Pe(()=>{},["stop"]))},null,8,["checked","indeterminate","onUpdate:checked"])):J("",!0),x(f(le),{strong:""},{default:v(()=>[M(P(i.name),1)]),_:2},1024),x(f(Z),{type:p(i)?"success":"default",size:"small",bordered:!1,round:""},{default:v(()=>[M(P(i.models.filter(l=>e.value.includes(l)).length)+" / "+P(i.models.length),1)]),_:2},1032,["type"])]),_:2},1024)]),default:v(()=>[x(f(Ee),{value:e.value,"onUpdate:value":s[2]||(s[2]=l=>e.value=l)},{default:v(()=>[x(f(I),{vertical:"",size:8,style:{"padding-left":"32px"}},{default:v(()=>[(N(!0),O(F,null,ee(i.models,l=>(N(),A(f(te),{key:l,value:l,label:l,"onUpdate:checked":()=>$(l)},null,8,["value","label","onUpdate:checked"]))),128))]),_:2},1024)]),_:2},1032,["value"])]),_:2},1032,["name"]))),128))]),_:1},8,["default-expanded-names"])])]),_:1}))}},et=Ie(Ze,[["__scopeId","data-v-34549400"]]);export{et as M,Te as N,Ve as a,Ue as b};
