import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  renderSpaceObject,
  SPACE_OBJECT_TYPES,
} from '../termweave/space/space-objects'
import { REALISTIC_PALETTES } from '../termweave/space/palettes'
import { renderBackground } from '../termweave/space/background'

function checksum(data: Uint8Array | string) {
  return createHash('sha256').update(data).digest('hex')
}

const GEN_HASH: Record<string, string> = {
  'object-default/terran-wet': '457a4f757cafcd2e44a5a0fcad26055a8bab3622dfd578b46dea186ca4205432',
  'object-default/terran-dry': 'f957e0131ce1661f3f8bdde697e6905e9eb4055568f76f90c9318fb90209ee3d',
  'object-default/islands': '9c500b34b279c83c591e2017f2838d820e3bac87df38f9b993aafe27020002bf',
  'object-default/no-atmosphere': 'cdc851dc805670fb5b6993f8dc49ff2b4f250d2351c356038a7d50375fa6d66b',
  'object-default/gas-giant-1': 'f418b638c15cc6bab54cebcab56091c1abb707d6451561d1925a02918b15dc8d',
  'object-default/gas-giant-2': 'a8454c4cc0299426dd035fd838fec78a7f2f9581b6c4c6292eb8e9405352ca9d',
  'object-default/ice-world': '026c83018827633769964c6a93a54108ebda07d48bf850d56ecbca5a4e7babbe',
  'object-default/lava-world': '9accd7c9886ccaa947014a4bbdf247e389ab6a1d193c49752ea0e8b960de1ee4',
  'object-default/asteroid': 'd8f4d0ac46bb67fe00e7e897fcdf4eeb523e0147c68ac08e5c1a61e07b8fedae',
  'object-default/black-hole': '132237fa1cdf516aaa0bd2265f579bcee0141504caa2a425b24647cc73583ca4',
  'object-default/galaxy': 'd5b24e09cd35752b348716449bf6f464a524844326c926c19fbfe7d51cf8d0ac',
  'object-default/star': 'a832dcf1b28e0d0d2c6713f4253dbf86015a79e664cd0376b47371b04ebcf1d2',
  'object-curated/terran-wet': 'a3ac271d245b097022f199604d7418fd3fa935ddaea805f679dcccb7630d28c6',
  'object-curated/terran-dry': '740d2b3a9bc9bf4e49b822637c14910a35aaf059cd1f36978a031ae31e937eb8',
  'object-curated/islands': '472f947316cac18235568fb8280f00dee119408776110b966bfe13c9c335cf48',
  'object-curated/no-atmosphere': '65576398f63e977bd019e8198a152ffdbb109c9d9a410254411909e7b9406a06',
  'object-curated/gas-giant-1': '349bf4420529fb05fb353c3f24b18a7dbc46af7df3446815e0859eee3069f964',
  'object-curated/gas-giant-2': '0766502e4ce4d3b5317e8280dbec81aea88953231c805407361770d60dcf6de2',
  'object-curated/ice-world': '3240408d705de7b8f9f89290e37b0e4129ff214742c67513ebdd6cca8ad9a0f9',
  'object-curated/lava-world': '5e894a3e4f96d5b6780e834ba504729f6fbb3a0bb2dfd9af2359de78ee1db4c6',
  'object-curated/asteroid': '29df47972b607d250d2f74f1d3701915698b09ef6883c5f5ac750adfc6056920',
  'object-curated/black-hole': 'ff837d2d4dd31046874034f51f1037785f45e8f3784ed1d576949ac0eaba8ea2',
  'object-curated/galaxy': '996606165d15617fd1bbf09e9a6eb55b9e25c45ebcbcc00d8dd0625cc4f12539',
  'object-curated/star': 'b839ad89aa51105f41be820b4c524ca5d288c7709b9309b0e84cd0723c98cbcb',
  'background': '6f83e7b32fbd8ae38c95a19a06e8c96ca08f52f8ed6e484d43ecd7ff12583bdd',
}

describe('golden renders', () => {
  test('12 types × default palettes match the pinned checksums', () => {
    for (const type of SPACE_OBJECT_TYPES) {
      const hash = checksum(renderSpaceObject({ type, seed: 4242 }).data)
      expect(hash, `object-default/${type}`).toBe(GEN_HASH[`object-default/${type}`])
    }
  })

  test('12 types × first curated palette match the pinned checksums', () => {
    for (const type of SPACE_OBJECT_TYPES) {
      const palette = REALISTIC_PALETTES[type][0]!.name
      const hash = checksum(renderSpaceObject({ type, seed: 4242, palette }).data)
      expect(hash, `object-curated/${type}`).toBe(GEN_HASH[`object-curated/${type}`])
    }
  })

  test('the fixed background matches its pinned checksum', async () => {
    const hash = checksum((await renderBackground(777)).data)
    expect(hash, 'background').toBe(GEN_HASH['background'])
  })
})
