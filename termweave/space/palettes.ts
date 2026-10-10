import { rgbaFromHex, type Rgba } from './color'
import type { SpaceObjectType } from './space-objects'

export interface SpaceObjectPalette {
  readonly name: string
  readonly colors: Partial<Record<string, Rgba[]>>
  readonly darkColors?: Partial<Record<string, Rgba[]>>
}

const hex = (...values: readonly string[]): Rgba[] => values.map(rgbaFromHex)

export const REALISTIC_PALETTES: Record<SpaceObjectType, readonly SpaceObjectPalette[]> = {
  'terran-wet': [
    {
      name: 'earth',
      colors: {
        land: hex('#8fce6e', '#5da64f', '#3f7a4d', '#284a45', '#4fa8b8', '#405073'),
        clouds: hex('#f2f7f3', '#dfe5e8', '#68789c', '#404957'),
      },
    },
    {
      name: 'desert-ocean',
      colors: {
        land: hex('#d9b174', '#b98a4e', '#8a5f3a', '#5c3f2e', '#3f8f9e', '#2c4a66'),
        clouds: hex('#f5eee0', '#e0d6c3', '#7a7d8f', '#4d4f5e'),
      },
    },
    {
      name: 'cold-ocean',
      colors: {
        land: hex('#b8d8d5', '#8fb5b8', '#628a95', '#3d5c6b', '#4f7fa8', '#2e4666'),
        clouds: hex('#ffffff', '#e8eef2', '#93a5b8', '#5c6a7d'),
      },
    },
    {
      name: 'alien-teal',
      colors: {
        land: hex('#79c2a0', '#4e9d7f', '#33705f', '#1f4a45', '#3e8fa0', '#2a4d6b'),
        clouds: hex('#eef7ee', '#d5e3da', '#6f887c', '#45564f'),
      },
    },
    {
      name: 'volcanic-isles',
      colors: {
        land: hex('#a3a36b', '#7d8452', '#55603f', '#36402f', '#2e7f8c', '#23424f'),
        clouds: hex('#efeadf', '#d8d2c4', '#6e7078', '#46474d'),
      },
    },
  ],
  'terran-dry': [
    { name: 'mars', colors: { land: hex('#d99e6a', '#c1794a', '#93553a', '#6d3d2c', '#4a2a20') } },
    { name: 'desert-tan', colors: { land: hex('#e6cfa3', '#cfa874', '#a97f52', '#7d5838', '#553b26') } },
    { name: 'red-iron', colors: { land: hex('#d97f5c', '#b25b42', '#8a4232', '#5f2c22', '#3f1d17') } },
    { name: 'basalt', colors: { land: hex('#a89a90', '#857a72', '#635a54', '#453e3a', '#2c2724') } },
  ],
  islands: [
    {
      name: 'pacific',
      colors: {
        water: hex('#92e0c0', '#4fa4b8', '#2d364d'),
        land: hex('#a5cc6a', '#74a852', '#4c7a45', '#2f4f3a'),
        clouds: hex('#eef2f4', '#d5dade', '#687a8c', '#414a57'),
      },
    },
    {
      name: 'caribbean',
      colors: {
        water: hex('#6fd9e0', '#37a3c4', '#1f5c85'),
        land: hex('#e8dfa8', '#c9b478', '#9a8655', '#6a5a3a'),
        clouds: hex('#f7f4ea', '#e3ddcf', '#7d8087', '#4e5055'),
      },
    },
    {
      name: 'volcanic-archipelago',
      colors: {
        water: hex('#5fa8a0', '#3d7d80', '#24485a'),
        land: hex('#6fae62', '#4d8a4f', '#356040', '#20402e'),
        clouds: hex('#e8ece9', '#ccd3cf', '#64726e', '#3d4745'),
      },
    },
    {
      name: 'arctic-isles',
      colors: {
        water: hex('#a8d4e0', '#6ba3c0', '#3d6a8c'),
        land: hex('#dce8ec', '#b4c9d1', '#8aa5b0', '#5c7a88'),
        clouds: hex('#ffffff', '#edf2f5', '#9db0bd', '#5f7280'),
      },
    },
  ],
  'no-atmosphere': [
    {
      name: 'moon',
      colors: { ground: hex('#a8a8a8', '#787878', '#505050'), craters: hex('#646464', '#424242') },
    },
    {
      name: 'mercury',
      colors: { ground: hex('#9c8f82', '#6e6359', '#4a423b'), craters: hex('#5c524a', '#3a342f') },
    },
    {
      name: 'mars-dead',
      colors: { ground: hex('#b5744d', '#8a5338', '#5e3826'), craters: hex('#7d4a33', '#52311f') },
    },
    {
      name: 'callisto',
      colors: { ground: hex('#8a7f70', '#635a4f', '#423c35'), craters: hex('#554e44', '#36312a') },
    },
    {
      name: 'ceres',
      colors: { ground: hex('#93938c', '#6b6b66', '#484844'), craters: hex('#5a5a55', '#3a3a37') },
    },
  ],
  'gas-giant-1': [
    {
      name: 'jupiter',
      colors: {
        clouds: hex('#8f6b4a', '#6e4f34', '#4a3420', '#2e1f13'),
        'clouds-top': hex('#e8d5b0', '#d9b47e', '#c08a52', '#96603a'),
      },
    },
    {
      name: 'saturn',
      colors: {
        clouds: hex('#b9a274', '#96805a', '#6f5e40', '#4a3f2b'),
        'clouds-top': hex('#f0e3c0', '#e3cf9d', '#cdb678', '#a98f58'),
      },
    },
    {
      name: 'neptune',
      colors: {
        clouds: hex('#2c4f9e', '#22407e', '#16294f', '#0d1832'),
        'clouds-top': hex('#6f9fe8', '#4f7fd0', '#3560a8', '#244482'),
      },
    },
    {
      name: 'uranus',
      colors: {
        clouds: hex('#8fd4d8', '#6fb4bc', '#4f8f9a', '#35636d'),
        'clouds-top': hex('#d5f0f2', '#b0dde2', '#8ac4cc', '#5fa3ad'),
      },
    },
  ],
  'gas-giant-2': [
    {
      name: 'saturn-ringed',
      colors: {
        gas: hex('#ecd9a8', '#d4b878', '#a9884d'),
        ring: hex('#e0d5b8', '#c0ae88', '#95835f'),
      },
      darkColors: {
        gas: hex('#8a6f45', '#5e4c30', '#3b3020'),
        ring: hex('#6f6148', '#473d2c', '#2b251b'),
      },
    },
    {
      name: 'blue-giant-ringed',
      colors: {
        gas: hex('#8fb8e8', '#5f8fd0', '#3d64a8'),
        ring: hex('#c8d4e8', '#9fb0d0', '#7285a8'),
      },
      darkColors: {
        gas: hex('#2a4680', '#1b2f5c', '#101c38'),
        ring: hex('#4f5c78', '#333d52', '#1e2432'),
      },
    },
    {
      name: 'brown-dwarf',
      colors: {
        gas: hex('#d9a06a', '#b57a48', '#8a5630'),
        ring: hex('#c9a97e', '#a3855e', '#77603f'),
      },
      darkColors: {
        gas: hex('#5f3a20', '#3f2615', '#26170c'),
        ring: hex('#524431', '#342a1e', '#1f1912'),
      },
    },
  ],
  'ice-world': [
    {
      name: 'europa',
      colors: {
        land: hex('#ece5dc', '#cfc4b6', '#a89886'),
        lakes: hex('#b06a4a', '#8a4c34', '#5f3222'),
        clouds: hex('#f5f8fa', '#e2e9ee', '#9aabb8', '#5f7284'),
      },
    },
    {
      name: 'enceladus',
      colors: {
        land: hex('#f4f8fa', '#dae4ea', '#b4c4cf'),
        lakes: hex('#8fb4c8', '#688ca4', '#46617a'),
        clouds: hex('#ffffff', '#eef4f7', '#a8bac6', '#6a7f8e'),
      },
    },
    {
      name: 'pluto',
      colors: {
        land: hex('#e0c8a8', '#c0a478', '#94714a'),
        lakes: hex('#f0ead8', '#cfc4a4', '#a89877'),
        clouds: hex('#e8dcc8', '#d0c2aa', '#8a8070', '#55504a'),
      },
    },
    {
      name: 'hoth',
      colors: {
        land: hex('#f0f5f8', '#d0dde5', '#a5bcc9'),
        lakes: hex('#78a8c8', '#5084a8', '#2f5c7d'),
        clouds: hex('#ffffff', '#edf3f7', '#a5b8c5', '#66798a'),
      },
    },
  ],
  'lava-world': [
    {
      name: 'ember-basalt',
      colors: {
        land: hex('#6e3a34', '#4a2622', '#2e1714'),
        craters: hex('#3a1e1a', '#241110'),
        lava: hex('#ffb35c', '#f2762e', '#c04324'),
      },
    },
    {
      name: 'dark-basalt-red',
      colors: {
        land: hex('#4a3430', '#32211e', '#1e1311'),
        craters: hex('#2a1a17', '#170e0c'),
        lava: hex('#ff6a3d', '#d94a24', '#a32f16'),
      },
    },
    {
      name: 'io-sulfur',
      colors: {
        land: hex('#d9c25c', '#b59a3f', '#8a7028'),
        craters: hex('#6e5a24', '#473a16'),
        lava: hex('#ff9e3d', '#e86a1f', '#b04514'),
      },
    },
    {
      name: 'cinder',
      colors: {
        land: hex('#3d3436', '#2a2325', '#191416'),
        craters: hex('#231d1f', '#141011'),
        lava: hex('#ff8c4a', '#d45c28', '#9c3417'),
      },
    },
  ],
  asteroid: [
    { name: 'bennu', colors: { asteroid: hex('#6b625a', '#4a433d', '#302b27') } },
    { name: 'vesta', colors: { asteroid: hex('#b0a698', '#857d70', '#5a544b') } },
    { name: 'psyche', colors: { asteroid: hex('#9c9490', '#736d6a', '#4d4846') } },
    { name: 'phobos', colors: { asteroid: hex('#9c7563', '#755645', '#4e382c') } },
  ],
  'black-hole': [
    {
      name: 'gargantua',
      colors: {
        core: hex('#1a1a24', '#fefefe', '#f5f2ea'),
        disk: hex('#fffdf5', '#ffecb8', '#ffb85c', '#e87a34', '#b04a20'),
      },
    },
    {
      name: 'blue-shift',
      colors: {
        core: hex('#101322', '#eef2ff', '#c8d4f5'),
        disk: hex('#f5f8ff', '#c8d8ff', '#92b0f0', '#5f84d9', '#3a56a8'),
      },
    },
    {
      name: 'crimson',
      colors: {
        core: hex('#201216', '#ffeff0', '#ffd4d4'),
        disk: hex('#fff0ee', '#ffc8b8', '#ff937d', '#e05a44', '#a83226'),
      },
    },
  ],
  galaxy: [
    {
      name: 'milky-way',
      colors: { galaxy: hex('#fff8e8', '#ffeec4', '#d4c8a0', '#a8b4c8', '#6a7fa8', '#3d4c73', '#232c47') },
    },
    {
      name: 'andromeda',
      colors: { galaxy: hex('#fff5e0', '#f0dcb0', '#c8c0a8', '#98a4bc', '#62779e', '#384a6e', '#212c46') },
    },
    {
      name: 'blue-spiral',
      colors: { galaxy: hex('#f5f9ff', '#dde9f8', '#b4c8e8', '#849ed4', '#5270a8', '#2e4674', '#1b2a4a') },
    },
    {
      name: 'golden-bar',
      colors: { galaxy: hex('#fff2d0', '#ffe9b8', '#d4bc85', '#a89060', '#70583c', '#463624', '#2c2216') },
    },
  ],
  star: [
    {
      name: 'red-dwarf',
      colors: {
        blobs: hex('#ffb8a0'),
        star: hex('#ffd9c4', '#ff9e78', '#d94f30', '#8a2418'),
        flares: hex('#ff8c5c', '#ffd9c4'),
      },
    },
    {
      name: 'orange-k',
      colors: {
        blobs: hex('#ffcf9c'),
        star: hex('#ffe8c0', '#ffb878', '#e07830', '#8a4416'),
        flares: hex('#ffb060', '#ffe8c0'),
      },
    },
    {
      name: 'sun-g',
      colors: {
        blobs: hex('#fff3c8'),
        star: hex('#fff8d8', '#ffe088', '#f0a830', '#a05c14'),
        flares: hex('#ffd860', '#fff8d8'),
      },
    },
    {
      name: 'white-a',
      colors: {
        blobs: hex('#f8f8ff'),
        star: hex('#ffffff', '#e8ecf8', '#b8c4e0', '#6a78a8'),
        flares: hex('#dce4f8', '#ffffff'),
      },
    },
    {
      name: 'blue-b',
      colors: {
        blobs: hex('#c8dcff'),
        star: hex('#e8f2ff', '#a8c4f8', '#5f88e0', '#2e4a9e'),
        flares: hex('#8fb4f8', '#e8f2ff'),
      },
    },
  ],
}

export function spaceObjectPaletteNames(type: SpaceObjectType): string[] {
  return REALISTIC_PALETTES[type].map((palette) => palette.name)
}
