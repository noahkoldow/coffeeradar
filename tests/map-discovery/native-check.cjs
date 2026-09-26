const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test'),ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'Fragment'};
let currentHooks=[],hookCursor=0;
function useState(initial){const hooks=currentHooks,index=hookCursor++;if(!(index in hooks))hooks[index]=initial;return [hooks[index],value=>{hooks[index]=value;}];}
const cache=new Map();
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require(name){
 if(name==='react')return {__esModule:true,default:react,useState};
 if(name==='react-native')return {View:'View',Text:'Text',Pressable:'Pressable',StyleSheet:{create:x=>x,absoluteFill:{},hairlineWidth:1}};
 if(name==='react-native-maps')return {__esModule:true,default:'MapView',Marker:'Marker'};
 if(name==='react-native-svg')return {__esModule:true,default:'Svg',Circle:'Circle',Line:'Line'};
 if(name==='expo-linear-gradient')return {LinearGradient:'LinearGradient'};
 if(name.endsWith('I18nProvider'))return {useI18n:()=>({language:'de'})};
 if(name.endsWith('ThemeProvider'))return {useTheme:()=>load('src/theme.ts').lightTheme};
 if(name==='./ActivityMap')return {ActivityMap:'ActivityMap'};
 const target=path.resolve(path.dirname(file),name);return load(fs.existsSync(target+'.ts')?target+'.ts':target+'.tsx');
}});return exports;}
function nodes(tree,type,out=[]){if(Array.isArray(tree)){tree.forEach(child=>nodes(child,type,out));return out;}if(tree&&typeof tree==='object'){if(tree.type===type)out.push(tree);nodes(tree.props?.children,type,out);}return out;}
const origin={latitude:52.52,longitude:13.405};
const activities=['walk','transit','car'].map((travelMode,i)=>({suggestion:{id:'place'+i,title:'Activity '+i,place:{name:'Place '+i}},coordinate:{latitude:52.52+i*.004,longitude:13.407+i*.008},travelMode,travelMin:8+i*5,emoji:'X'}));
const helpers=load('src/components/ActivityMap.types.ts');
const map=load('src/components/ActivityMap.native.tsx').ActivityMap;
function fixture(initial={}){
 const hooks=[];let props={activities,origin,preview:true,onSelect(){},...initial};
 return {render(update={}){props={...props,...update};currentHooks=hooks;hookCursor=0;return map(props);}};
}
// Ignore only event/interactivity props: native element types, keys, content,
// geometry and camera region must all remain identical through promotion.
const visualTree=tree=>JSON.parse(JSON.stringify(tree,(key,value)=>
 ['pointerEvents','accessibilityElementsHidden','importantForAccessibility','tappable'].includes(key)||typeof value==='function'?undefined:value));

test('native map promotion preserves the surface, content and measured camera region',()=>{
 const card=fixture();const initial=card.render();const initialMap=nodes(initial,'MapView')[0];assert.ok(initialMap);
 initial.props.onLayout({nativeEvent:{layout:{width:360,height:240}}});
 const preview=card.render();const previewMap=nodes(preview,'MapView')[0];
 assert.notDeepEqual(previewMap.props.region,initialMap.props.region,'preview measures the final aspect before activation');
 const active=card.render({preview:false});const activeMap=nodes(active,'MapView')[0];
 assert.deepEqual(visualTree(active),visualTree(preview));
 assert.deepEqual(activeMap.props.region,previewMap.props.region);
 assert.deepEqual(visualTree(card.render({preview:true})),visualTree(preview),'undo preserves the same native surface contract');
 for(const tree of [preview,active])for(const property of ['scrollEnabled','zoomEnabled','pitchEnabled','rotateEnabled','zoomTapEnabled','moveOnMarkerPress','toolbarEnabled','showsUserLocation','showsMyLocationButton'])assert.equal(nodes(tree,'MapView')[0].props[property],false);
});

test('native preview markers stay inert and hidden from accessibility until active',()=>{
 const picked=[];const card=fixture({onSelect:id=>picked.push(id)});
 for(const preview of [true,false,true]){
  const tree=card.render({preview});
  assert.equal(tree.props.pointerEvents,preview?'none':'auto');
  assert.equal(tree.props.accessibilityElementsHidden,preview);
  assert.equal(tree.props.importantForAccessibility,preview?'no-hide-descendants':'auto');
  const markers=nodes(tree,'Marker');assert.equal(markers[0].props.tappable,false,'origin is never interactive');
  const pins=markers.filter(marker=>marker.props.onPress);assert.equal(pins.length,3);
  const before=picked.length;let stopped=0;
  for(const pin of pins){assert.equal(pin.props.tappable,!preview);pin.props.onPress({stopPropagation(){stopped++;}});}
  assert.equal(stopped,3);
  assert.equal(picked.length,before+(preview?0:3),'even directly delivered preview callbacks cannot select activities');
 }
 assert.deepEqual(picked,['place0','place1','place2']);
});

test('invalid origins retain the diagram fallback and invalid destinations never mount native pins',()=>{
 const diagram=load('src/components/ActivityMapDiagram.tsx').ActivityMapDiagram;
 for(const preview of [true,false])for(const invalid of [{latitude:NaN,longitude:0},{latitude:91,longitude:0},{latitude:0,longitude:181}]){
  const tree=fixture({origin:invalid,preview}).render();assert.equal(tree.type,diagram);assert.equal(nodes(tree,'MapView').length,0);
 }
 const tree=fixture({activities:[{...activities[0],coordinate:{latitude:Infinity,longitude:0}},...activities.slice(1)]}).render();
 assert.deepEqual(nodes(tree,'Marker').filter(marker=>marker.props.onPress).map(marker=>marker.props.identifier),['place1','place2']);
});

test('native map labels and viewport keep explicit travel modes and date-line handling',()=>{
 assert.equal(helpers.travelIcon('walk'),'🚶');assert.equal(helpers.travelIcon('transit'),'🚌');assert.equal(helpers.travelIcon('car'),'🚗');
 const dateline=helpers.mapViewport({latitude:0,longitude:179.99},[{coordinate:{latitude:0,longitude:-179.99}}]);assert.ok(dateline.longitudeDelta<.1);
 assert.ok(helpers.isMapCoordinate({latitude:0,longitude:0}));assert.ok(!helpers.isMapCoordinate({latitude:91,longitude:0}));
});
