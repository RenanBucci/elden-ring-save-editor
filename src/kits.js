// IDs checked against the installed game's item texts (base game and Shadow of the Erdtree).
// Weapons come at the highest level they accept; stackables come at the maximum the bag holds.

const set = (base) => [base, base + 100, base + 200, base + 300].map((id) => ['armor', id]);

export const KITS = [
    {
        id: 'bleed',
        title: 'Sangramento',
        hint: 'Arcano e Destreza',
        description: 'Rios de Sangue e Uchigatana com Seppuku, os talismãs que aumentam dano após sangrar e a Máscara Branca.',
        items: [
            ['weapon', 9040000], ['weapon', 9000000], ['ash', 60600], ['ash', 20400],
            ['talisman', 2160], ['talisman', 2081], ['talisman', 1250], ['talisman', 1231],
            ['armor', 680000], ['goods', 6320],
        ],
    },
    {
        id: 'sorcery',
        title: 'Feiticeiro de cometa',
        hint: 'Inteligência',
        description: 'Cajado de Lusat, Cetro Cariano, Bólido Escuro, as luas de Rennala e Ranni e o conjunto de Azur e Lusat.',
        items: [
            ['weapon', 33240000], ['weapon', 33090000], ['weapon', 3090000],
            ['goods', 4200], ['goods', 4360], ['goods', 4361], ['goods', 4130], ['goods', 4080],
            ['talisman', 3001], ['talisman', 3090], ['talisman', 2000], ['talisman', 1051],
            ['armor', 581000], ['armor', 580100], ['armor', 580200], ['armor', 580300],
        ],
    },
    {
        id: 'faith',
        title: 'Fé dourada',
        hint: 'Fé',
        description: 'Selo da Térvore, Lâmina Blasfema, Chama Negra, Voto Dourado, relâmpagos dracônicos e a armadura da Árvore Sacra.',
        items: [
            ['weapon', 34070000], ['weapon', 3140000],
            ['goods', 6210], ['goods', 6600], ['goods', 6050], ['goods', 6900], ['goods', 6910], ['goods', 6431],
            ['talisman', 3050], ['talisman', 3090], ['talisman', 2030], ['talisman', 1051],
            ...set(1820000),
        ],
    },
    {
        id: 'strength',
        title: 'Força colossal',
        hint: 'Força e Vigor',
        description: 'Esmagador de Gigante, Espada do Flagelo Estelar, Garra de Leão e o conjunto Touro-Cabra para aguentar porrada.',
        items: [
            ['weapon', 23110000], ['weapon', 4050000], ['weapon', 4000000], ['ash', 10000],
            ['talisman', 2130], ['talisman', 2180], ['talisman', 1032], ['talisman', 1042], ['talisman', 1060], ['talisman', 4003],
            ...set(140000),
        ],
    },
    {
        id: 'samurai',
        title: 'Samurai da lua',
        hint: 'Destreza e Inteligência',
        description: 'Véu da Lua, Nagakiba e Presa do Cão de Caça, Passo do Cão de Caça e o conjunto Faca Negra.',
        items: [
            ['weapon', 9060000], ['weapon', 9010000], ['weapon', 8030000], ['ash', 80100], ['ash', 21600],
            ['talisman', 2080], ['talisman', 1250], ['talisman', 2200], ['talisman', 3001],
            ...set(180000),
        ],
    },
    {
        id: 'dlc',
        title: 'Terra das Sombras',
        hint: 'Shadow of the Erdtree',
        description: 'Armas de Messmer, Rellana e Sta. Trina, talismãs novos, conjunto de Messmer e fragmentos para as bênçãos.',
        items: [
            ['weapon', 17500000], ['weapon', 67520000], ['weapon', 67500000], ['weapon', 14510000], ['weapon', 2510000],
            ['talisman', 8220], ['talisman', 8190], ['talisman', 8130], ['talisman', 8100], ['talisman', 8000], ['talisman', 7000], ['talisman', 7010],
            ...set(5220000),
            ['goods', 2010000], ['goods', 2010100],
        ],
    },
    {
        id: 'smithing',
        title: 'Forja completa',
        hint: 'Melhorar qualquer arma',
        description: 'Todas as Pedras de Forja e Pedras Sombrias, incluindo as de Dragão Ancião, na quantidade máxima.',
        items: [
            ...[10100, 10101, 10102, 10103, 10104, 10105, 10106, 10107, 10140].map((id) => ['goods', id]),
            ...[10160, 10161, 10162, 10163, 10164, 10165, 10166, 10167, 10200, 10168].map((id) => ['goods', id]),
        ],
    },
    {
        id: 'progress',
        title: 'Frascos e runas',
        hint: 'Progressão',
        description: 'Sementes Douradas e Lágrimas Sagradas para os frascos, Arcos de Runa, Lágrimas Larvais e Chaves de Espada de Pedra.',
        items: [['goods', 10010], ['goods', 10020], ['goods', 190], ['goods', 8185], ['goods', 8000], ['goods', 10909], ['goods', 10919]],
    },
];
