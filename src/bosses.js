// Retrato de cada chefe principal. O ícone vem de um item real do jogo
// (lembrança, arma ou peça) e o nome é o usado no texto em português.
const BOSSES = {
    'Godrick the Grafted': { icon: 163, name: 'Godrick, o Enxertado' },
    'Margit, the Fell Omen': { icon: 165, name: 'Margit, o Agouro Caído' },
    'Grafted Scion': { icon: 10046, name: 'Rebento Enxertado' },
    'Morgott, the Omen King': { icon: 165, name: 'Morgott, o Rei Agouro' },
    'Godfrey, First Elden Lord': { icon: 170, name: 'Godfrey, Primeiro Lorde Prístino' },
    'Sir Gideon Ofnir, the All-Knowing': { icon: 10410, name: 'Sir Gideon Ofnir, o Onisciente' },
    'Hoarah Loux': { icon: 170, name: 'Hoarah Loux' },
    'Astel, Naturalborn of the Void': { icon: 177, name: 'Astel, Filho Natural do Vazio' },
    'Dragonkin Soldier of Nokstella': { icon: 10694, name: 'Soldado Draconiano de Nokstella' },
    'Lichdragon Fortissax': { icon: 173, name: 'Fortissax, Dragão Lich' },
    'Mohg, Lord of Blood': { icon: 168, name: 'Mohg, Lorde do Sangue' },
    'Dragonlord Placidusax': { icon: 171, name: 'Placidusax, Lorde Dragão' },
    'Maliketh, the Black Blade': { icon: 169, name: 'Maliketh, a Lâmina Negra' },
    'Rennala, Queen of the Full Moon': { icon: 172, name: 'Rennala, Rainha da Lua Cheia' },
    'Royal Knight Loretta': { icon: 10690, name: 'Loretta, Cavaleira Real' },
    'Malenia, Blade of Miquella': { icon: 167, name: 'Malenia, Espada de Miquella' },
    'Rykard, Lord of Blasphemy': { icon: 166, name: 'Rykard, Lorde da Blasfêmia' },
    'the Elden Beast': { icon: 176, name: 'A Fera Prístina' },
    'Starscourge Radahn': { icon: 164, name: 'Radahn, Flagelo Estelar' },
    'Fire Giant': { icon: 174, name: 'Gigante de Fogo' },
    'Regal Ancestor Spirit': { icon: 175, name: 'Espírito Ancestral Real' },
    'Dragonkin Soldier - Lake of Rot': { icon: 10694, name: 'Soldado Draconiano do Lago da Podridão' },
    "Fia's Champion": { icon: 15340, name: 'Campeão de Fia' },
    'Elemer of the Briar': { icon: 10095, name: 'Elemer do Espinheiro' },
    'Commander Niall': { icon: 10811, name: 'Comandante Niall' },
    'Radahn, Consort of Miquella': { icon: 739, name: 'Radahn, Consorte de Miquella' },
    'Messmer the Impaler': { icon: 733, name: 'Messmer, o Empalador' },
    'Commander Gaius': { icon: 15505, name: 'Comandante Gaius' },
    'Scadutree Avatar': { icon: 734, name: 'Avatar da Árvore-Sombra' },
    'Rellana, Twin Moon Knight': { icon: 735, name: 'Rellana, Cavaleira das Luas Gêmeas' },
    'Romina, Saint of the Bud': { icon: 736, name: 'Romina, Santa do Broto' },
    'Divine Beast Dancing Lion': { icon: 737, name: 'Leão Dançante da Fera Divina' },
    'Midra, Lord of Frenzied Flame': { icon: 740, name: 'Midra, Lorde da Chama Frenética' },
    'Metyr, Mother of Fingers': { icon: 741, name: 'Metyr, Mãe dos Dedos' },
    'Putrescent Knight': { icon: 742, name: 'Cavaleiro Putrescente' },
};

export function bossOf(english) {
    return BOSSES[english] || null;
}
