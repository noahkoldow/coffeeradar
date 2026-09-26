const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const artifacts=path.join(__dirname,'../artifacts/map-discovery');fs.mkdirSync(artifacts,{recursive:true});
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const checks=[];
  for(const width of [320,390])for(const language of ['en','de'])for(const count of [1,2,3]){
    console.log(`Checking ${width}px ${language} ${count}`);
    await page.setViewportSize({width,height:680});
    await page.goto(`http://localhost:8099/?language=${language}&count=${count}`,{timeout:120000});
    await page.getByTestId('selection').waitFor({timeout:120000});
    const buttons=page.getByRole('button');
    assert.equal(await buttons.count(),count*2);
    const card=await page.getByTestId('card-frame').locator(':scope > div').first().boundingBox();
    assert.equal(card.height,420);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'horizontal overflow');
    const modes=await buttons.allTextContents();
    assert.ok(modes.join('').includes('🚶'));
    if(count>=2)assert.ok(modes.join('').includes('🚌'));
    if(count>=3)assert.ok(modes.join('').includes('🚗'));
    const label=language==='de'?'Zurück zur Karte':'Back to map';
    for(let index=0;index<count;index++){
      for(const row of [false,true]){
        await page.getByRole('button').nth(index+(row?count:0)).click();
        assert.equal(await page.getByTestId('selection').textContent(),`Selected: ${['coffee','park','art'][index]}`);
        await page.getByRole('button',{name:label,exact:true}).click();
        assert.equal(await page.getByTestId('selection').textContent(),'Selected: map');
      }
    }
    await page.screenshot({path:path.join(artifacts,`map-${width}-${language}-${count}.png`)});
    checks.push(`${width}px ${language}, ${count} options: pins + rows + activity return passed`);
  }
  await page.goto('http://localhost:8099/?language=de&count=3&theme=dark');
  await page.getByTestId('selection').waitFor();
  await page.screenshot({path:path.join(artifacts,'map-390-de-dark.png')});
  await page.getByRole('button').nth(0).click();
  await page.screenshot({path:path.join(artifacts,'selected-390-de.png')});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({checks,pageErrors:errors,artifacts},null,2));
  await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
