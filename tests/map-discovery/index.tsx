import React, { useRef, useState } from 'react';
import { registerRootComponent } from 'expo';
import { Pressable, Text, View } from 'react-native';
import { useFonts, SpaceGrotesk_400Regular, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import type { MapActivityOption } from '../../src/components/ActivityMap.types';
import { MapDiscoveryCard } from '../../src/components/MapDiscoveryCard';
import { SuggestionCard } from '../../src/components/SuggestionCard';
import { SwipeDeck, SwipeDeckHandle } from '../../src/components/SwipeDeck';
const query = new URLSearchParams(window.location.search);
const de = query.get('language') === 'de';
const count = Number(query.get('count') || 3);
const origin = {latitude:52.52, longitude:13.405};
const allOptions: MapActivityOption[] = [
  {suggestion:{id:'coffee',type:'GO_OUT',title:de?'Zeit für einen guten Kaffee':'Find your new favourite coffee',description:'Take a break and enjoy a well-made coffee.',durationMin:25,source:'curated',confidence:1,emojis:['☕'],tags:['coffee'],place:{name:'Kaffeekirsche',lat:52.522,lng:13.408},meta:{etaMin:8,travelMode:'walk'}},coordinate:{latitude:52.522,longitude:13.408},travelMin:8,travelMode:'walk',emoji:'☕'},
  {suggestion:{id:'park',type:'GO_OUT',title:de?'Einmal durch den Park schlendern':'A little green escape',description:'A gentle walk through the park.',durationMin:35,source:'curated',confidence:1,emojis:['🌳'],tags:['nature'],place:{name:'Volkspark Friedrichshain',lat:52.526,lng:13.421},meta:{etaMin:14,travelMode:'transit'}},coordinate:{latitude:52.526,longitude:13.421},travelMin:14,travelMode:'transit',emoji:'🌳'},
  {suggestion:{id:'art',type:'GO_OUT',title:de?'Entdecke etwas Überraschendes':'Meet your next favourite artwork',description:'Explore the latest exhibition.',durationMin:40,source:'curated',confidence:1,emojis:['🎨'],tags:['art'],place:{name:'Galerie am Augustplatz',lat:52.513,lng:13.404},meta:{etaMin:12,travelMode:'car'}},coordinate:{latitude:52.513,longitude:13.404},travelMin:12,travelMode:'car',emoji:'🎨'},
];
const options = allOptions.slice(0,count);
function Harness(){
  const [selected,setSelected] = useState<string | null>(null);
  const [remaining,setRemaining] = useState(options);
  const [skipped,setSkipped] = useState(false);
  const [swipes,setSwipes] = useState({left:0,right:0});
  const deckRef = useRef<SwipeDeckHandle>(null);
  const [loaded] = useFonts({SpaceGrotesk_400Regular,SpaceGrotesk_600SemiBold,SpaceGrotesk_700Bold});
  const chosen=remaining.find(option=>option.suggestion.id===selected);
  const deckMode=query.get('deck')==='1';
  const afterMap={...options[0].suggestion,id:'after-map',title:'After map'};
  const mapCard={...options[0].suggestion,id:'map',title:'Nearby possibilities'};
  const current=skipped?afterMap:chosen?.suggestion??mapCard;
  const onLeft=()=>{setSwipes(value=>({...value,left:value.left+1}));if(chosen){setRemaining(value=>value.filter(option=>option.suggestion.id!==chosen.suggestion.id));setSelected(null);}else setSkipped(true);};
  const onRight=()=>{setSwipes(value=>({...value,right:value.right+1}));setSkipped(true);setSelected(null);};
  if(!loaded)return <Text>Loading fonts</Text>;
  return <View style={{width:'100%',padding:12,paddingTop:24,backgroundColor:query.get('theme')==='dark'?'#0F1218':'#F1F1EC',minHeight:'100%',alignItems:'center'}}>
    <View testID="card-frame" style={{width:'100%',maxWidth:390}}>
      {deckMode?<><SwipeDeck ref={deckRef} current={current} next={skipped?null:afterMap} rightSwipeEnabled={!!chosen||skipped} onSwipeLeft={onLeft} onSwipeRight={onRight} renderCard={(card,preview)=>card.id==='map'?<MapDiscoveryCard activities={remaining} origin={origin} preview={preview} onSelect={setSelected}/>:<SuggestionCard suggestion={card} preview={preview} animateEntrance={false}/>}/>{chosen&&<Pressable accessibilityRole="button" accessibilityLabel={de?'Zurück zur Karte':'Back to map'} onPress={()=>setSelected(null)} style={{padding:10,backgroundColor:'#D6E0FA',borderRadius:8,marginTop:8}}><Text>{de?'← Zurück zur Karte':'← Back to map'}</Text></Pressable>}</>:chosen?<><Pressable accessibilityRole="button" accessibilityLabel={de?'Zurück zur Karte':'Back to map'} onPress={()=>setSelected(null)} style={{padding:10,backgroundColor:'#D6E0FA',borderRadius:8,marginBottom:8}}><Text>{de?'← Zurück zur Karte':'← Back to map'}</Text></Pressable><SuggestionCard suggestion={chosen.suggestion}/></>:<MapDiscoveryCard activities={remaining} origin={origin} onSelect={setSelected}/>}
    </View>
    <Text testID="selection" style={{marginTop:20}}>Selected: {skipped?'after-map':selected||'map'}</Text>
    {deckMode&&<><Text testID="swipe-counts">{JSON.stringify(swipes)}</Text><Pressable testID="imperative-right" accessibilityRole="button" onPress={()=>deckRef.current?.swipeRight()}><Text>Try right action</Text></Pressable></>}
  </View>;
}
registerRootComponent(Harness);
