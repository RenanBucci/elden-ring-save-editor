// Isolated renderer regression test. All save commands use in-memory fixtures.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
app.disableHardwareAcceleration();
fs.mkdirSync(path.join(root, 'qa'), {recursive:true});
app.setPath('userData', fs.mkdtempSync(path.join(root, 'qa', 'renderer-')));
const params = require('../public/data/itemParams.json');
const world = require('../data/world.json');
const ops = require('./fixtures/operations.json');
const report = [];
const errors = [];
let activeFile = 'fixture-a.sl2';
let characterName = 'Test character';
let quantity = 12;
let rejectQuantity = false;
let quantityAttempts = 0;
const characters = () => Array.from({length:10}, (_,index) => ({index, empty:index>1, name:index === 0 ? characterName : 'Second character', level:120, classId:0}));
const inventory = (container) => [
    ...params.weapons.filter(item=>item.paramId>110000 && item.paramId%10000===0).slice(0,18).map((item,index)=>({kind:'weapon',paramId:item.paramId,handle:0x80000000+index,index,container,quantity:1})),
    {kind:'weapon',paramId:110000,handle:0x8000ffff,index:90,container,quantity:1},
    {kind:'armor',paramId:10000,handle:0x9000ffff,index:91,container,quantity:1},
    {kind:'goods',paramId:166,handle:0xb00000a6,index:92,container,quantity:1},
    {kind:'goods',paramId:2130,handle:0xb0000852,index:18,container,quantity},
];
const nameRows = (lang) => [
    ...[['weapon','weapons'],['armor','armor'],['talisman','accessories'],['goods','goods']].flatMap(([kind,key])=>params[key].filter(x=>x.paramId>0).map(x=>[kind,x.paramId,lang==='en' ? `Test ${kind} ${x.paramId}` : `PT ${kind} ${x.paramId}`,0])),
];
ipcMain.handle('test:command', async (_event, command, args={}) => {
    switch(command) {
    case 'item_icon': return {ok:false};
    case 'detect': return {ok:true,gameRunning:false,saves:[{fileName:activeFile,path:activeFile,steamId:'test',modifiedAt:0}],gameDir:'test-game'};
    case 'slots': return {ok:true,file:activeFile,slots:characters()};
    case 'open_save': activeFile=args.file; characterName='Other save character'; return {ok:true,slots:characters()};
    case 'character': return {ok:true,character:{name:characterName,classId:0,gender:0,stats:[40,20,30,30,30,20,20,9],level:120,consistent:true}};
    case 'operations': return {operations:ops};
    case 'inventory': await new Promise(r=>setTimeout(r,args.container==='inventory'?70:5)); return {ok:true,items:inventory(args.container)};
    case 'equipment': return {ok:true,items:[{slot:1,group:'right',label:'Mão direita 1',empty:false,...inventory('inventory')[0]}, {slot:12,group:'armor',label:'Cabeça',empty:true}, {slot:17,group:'talisman',label:'Talismã 1',empty:true}]};
    case 'catalog_all': return {ok:true,rows:nameRows(args.lang)};
    case 'appearance': return {ok:true,bytes:Array(288).fill(100),gender:0};
    case 'world': return world;
    case 'flags': return {ok:true,flags:args.ids.map(id=>({id,on:false}))};
    case 'world_map': return {ok:false,error:'O mapa não respondeu.'};
    case 'backups': return {ok:true,backups:[{label:'antes-de-desfazer',file:'test.sl2',path:'test.sl2',createdAt:0,bytes:26000000}]};
    case 'mods_status': return {ok:true,ours:false,canRevert:false};
    case 'save_copy': return {ok:true,path:'fixture/_editor_exports/copy.sl2'};
    case 'undo': characterName='Restored character'; return {ok:true};
    case 'apply':
        if(args.request.quantities) quantityAttempts++;
        if(args.request.quantities && rejectQuantity) return {ok:false,error:'Inventário sem espaço livre.'};
        if(args.request.quantities) quantity=args.request.quantities[0].quantity;
        if(args.request.character?.name) characterName=args.request.character.name;
        return {ok:true};
    default: return {ok:false,error:`Unexpected test command: ${command}`};
    }
});

app.whenReady().then(async()=>{
    const dist=path.join(root,'dist');
    const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
    const server=http.createServer((req,res)=>{
        const file=path.resolve(dist,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
        if(!file.startsWith(dist+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
        res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
        fs.createReadStream(file).pipe(res);
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const win=new BrowserWindow({show:false,width:1400,height:900,useContentSize:true,webPreferences:{preload:path.join(__dirname,'ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
    win.webContents.on('console-message',(event)=>{const {level,message}=event;if(level==='error' && !/404|ERR_CERT|Content Security Policy/.test(message)) { errors.push(message); console.error('RENDERER:',message); }});
    const run=async(code)=>{try{return await win.webContents.executeJavaScript(code);}catch(error){throw new Error(`${error.message}\nScript: ${code}\nLast case: ${JSON.stringify(report.at(-1))}`);}};
    const settle=()=>run('new Promise(r=>setTimeout(r,200))');
    const click=async(label,selector='button')=>{
        await run(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!b) throw Error('Missing control: '+${JSON.stringify(label)});b.click();})()`);
        await settle();
    };
    const locale=async(lang)=>{await run(`(()=>{const s=document.querySelector('.top-actions select');s.value=${JSON.stringify(lang)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);await settle();};
    const input=async(selector,value,blur=false)=>{
        await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));${blur?"e.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));":''}})()`);await settle();
    };
    const output=path.join(root,'qa','screenshots');fs.mkdirSync(output,{recursive:true});
    try {
        await win.loadURL(`http://127.0.0.1:${server.address().port}`);await settle();await locale('en');
        for(const [width,height] of [[1024,700],[1180,800],[1400,900],[1920,1080]]) {
            win.setContentSize(width,height);await settle();
            for(const page of ['EDITOR','INVENTORY','ADD ITEMS','BUILDS & KITS','WORLD','APPEARANCE','GAME MODS','BACKUPS','SLOTS','ABOUT']) {
                await click(page,'.nav');
                if(page==='ADD ITEMS') {await click('Medium');await run("document.querySelector('.item-card').click()");await settle();}
                const modes=['INVENTORY','ADD ITEMS'].includes(page)?['Large','Medium','Table']:[null];
                for(const mode of modes) {
                    if(mode) await click(mode);
                    const measured=await run(`(()=>{
                        const main=document.querySelector('main');const body=document.body;
                        const overflow=Math.max(main.scrollWidth-main.clientWidth,body.scrollWidth-body.clientWidth);
                        const cards=[...document.querySelectorAll('.item-card')];
                        const broken=cards.filter(e=>e.scrollWidth>e.clientWidth+1).length;
                        return {overflow,broken,text:document.querySelector('main').innerText};
                    })()`);
                    assert.ok(measured.overflow<=1,`${page} ${mode} ${width}: overflow ${measured.overflow}`);
                    assert.equal(measured.broken,0,`${page} ${mode} ${width}: broken cards`);
                    assert.ok(!/\b(Nome|Corpo|Armas|Armaduras|Talismãs|Quantidade|Desfazer|Personagem|Graças|Fechar|Aplicar|Sangramento|Copiar|Atributos|Itens-chave)\b/.test(measured.text),`${page}: Portuguese text: ${measured.text.slice(0,350)}`);
                    report.push({width,height,page,mode,overflow:measured.overflow,cards:await run("document.querySelectorAll('.item-card').length")});
                    if(width===1024 && ['APPEARANCE','ADD ITEMS','EDITOR'].includes(page) && mode!=='Large' && mode!=='Table') {
                        fs.writeFileSync(path.join(output,`${page.replaceAll(' ','-').toLowerCase()}-${width}.png`),(await win.webContents.capturePage()).toPNG());
                    }
                }
            }
        }
        assert.ok(await run("document.querySelector('.risk-disclaimer').textContent.includes('account ban')"),'Missing startup risk disclaimer');
        await click('EDITOR','.nav');
        assert.equal(await run("document.querySelectorAll('.risk').length"),0,'Misleading safety badge');
        await click('INVENTORY','.nav');
        assert.equal(await run("document.querySelectorAll('.equipped,.equip-picker').length"),0,'Equipment internals exposed');
        assert.ok(!(await run("document.querySelector('main').innerText")).match(/Unarmed|#166|Armor #10000/),'Internal rows visible');
        await click('ADD ITEMS','.nav');await click('Medium');await run("document.querySelector('.item-card').click()");await settle();
        const enName=await run("document.querySelector('.detail h3').textContent");
        await locale('pt-BR');
        assert.notEqual(await run("document.querySelector('.detail h3').textContent"),enName,'Selected item did not change language');
        await locale('en');assert.equal(await run("document.querySelector('.detail h3').textContent"),enName);
        await click('EDITOR','.nav');
        for(let index=1;index<=8;index++) await input(`.stats label:nth-child(${index}) input`,'1');
        await click('Save changes');
        assert.ok((await run("document.querySelector('.toast').textContent")).includes('at least 80'),'Invalid level was not blocked');
        await input('.character-card input','Saved via header');
        // Restore valid stats after the low-level rejection above.
        for(let index=1;index<=8;index++) await input(`.stats label:nth-child(${index}) input`,'20');
        await click('Save');
        assert.equal(characterName,'Saved via header','Header Save did not apply draft');
        await click('Save copy');
        assert.ok((await run("document.querySelector('.toast').textContent")).includes('copy.sl2'),'Copy path missing');
        await input('.character-card input','Unsaved draft');
        await click('Undo');assert.equal(await run("document.querySelector('.character-card input').value"),'Restored character','Undo left stale draft');
        await click('SLOTS','.nav');await input('.save-chooser form input','fixture-b.sl2');await click('Open');
        assert.equal(await run("document.querySelector('.character-card input').value"),'Other save character','Switching saves left a stale draft');
        await click('INVENTORY','.nav');rejectQuantity=true;await input('.item-actions input','31',true);
        assert.equal(quantityAttempts,1,'Quantity edit did not reach the mock backend');
        assert.equal(await run("document.querySelector('.item-actions input').value"),'12','Failed write left a false quantity');
        assert.equal(quantity,12);assert.ok((await run("document.querySelector('.toast').textContent")).includes('Inventory is full'));
        assert.equal(await run("localStorage.getItem('language')"),'en');
        assert.equal(await run("document.documentElement.lang"),'en');
        win.webContents.reload();await new Promise(r=>win.webContents.once('did-finish-load',r));await settle();
        assert.equal(await run("document.querySelector('.top-actions select').value"),'en','Language did not persist');
        assert.deepEqual(errors,[],'Renderer console errors');
        fs.writeFileSync(path.join(root,'qa','ui-results.json'),JSON.stringify({checks:report.length,report,errors,regressions:['selected item language','invalid level rejected','header save','whole save copy','undo refresh','save switch refresh','failed quantity rollback','language persistence']},null,2));
        console.log(`PASS: ${report.length} layout/language cases and 8 state regressions`);
        app.exit(0);
    } catch(error) {console.error(error);fs.writeFileSync(path.join(root,'qa','ui-failure.png'),(await win.webContents.capturePage()).toPNG());app.exit(1);}
});
