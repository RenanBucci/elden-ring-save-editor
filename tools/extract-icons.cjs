// Optional local-only extraction. Never commit or redistribute the generated images.
const path = require('node:path');
const {IconExtractor} = require('./game-data/iconExtractor');
const game = process.env.ER_GAME_DIR;
if (!game) throw Error('Set ER_GAME_DIR to your Elden Ring Game directory.');
if (!process.env.LOCALAPPDATA) throw Error('Windows LOCALAPPDATA is required.');
const extractor = new IconExtractor(path.join(process.env.LOCALAPPDATA,'EldenRingSaveEditor','cache','icons'));
extractor.gameDir = game;
extractor.extract().then(result => { if (!result.success) throw Error(result.error || 'Icon extraction failed'); console.log('Local icon cache is ready. Restart the editor.'); }).catch(error => {console.error(error.message);process.exitCode=1;});
