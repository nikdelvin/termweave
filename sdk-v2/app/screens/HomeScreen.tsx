import { PixelRenderer } from '#termweave'
import { getAppConfig } from '../../shared/config'
import campfireUri from '../assets/campfire.gif' with { type: 'file' }
import { ScreenControls } from '../components/ScreenControls'
import { HOME_SCREEN } from '../screen-state'

export function HomeScreen() {
  const config = getAppConfig()
  const cols = config.terminalGrid.cols
  const rows = config.terminalGrid.rows
  const centerX = Math.floor(cols / 2)
  const centerY = Math.floor(rows / 2)

  return (
    <PixelRenderer uri={campfireUri} width="100%" height="100%">
      <box
        position="absolute"
        top={0}
        left={0}
        width={cols}
        height={rows}
        border
        borderStyle="heavy"
        borderColor="#FFFFFF"
      />
      <box
        position="absolute"
        top={3}
        left={6}
        width={cols - 12}
        height={rows - 6}
        border
        borderStyle="heavy"
        borderColor="#FFFFFF"
      />
      <box
        position="absolute"
        top={8}
        left={14}
        width={cols - 28}
        height={rows - 16}
        border
        borderStyle="heavy"
        borderColor="#FFFFFF"
      />

      <text position="absolute" top={1} left={4} fg="#FFFFFF">
        TOP LEFT
      </text>
      <text position="absolute" top={1} left={cols - 13} fg="#FFFFFF">
        TOP RIGHT
      </text>
      <text position="absolute" top={rows - 2} left={4} fg="#FFFFFF">
        BOTTOM LEFT
      </text>
      <text position="absolute" top={rows - 2} left={cols - 16} fg="#FFFFFF">
        BOTTOM RIGHT
      </text>

      <text position="absolute" top={centerY - 1} left={centerX - 1} fg="#FFFFFF">
        ┃
      </text>
      <text position="absolute" top={centerY} left={centerX - 7} fg="#FFFFFF">
        ━━━━━━╋━━━━━━
      </text>
      <text position="absolute" top={centerY + 1} left={centerX - 1} fg="#FFFFFF">
        ┃
      </text>
      <text position="absolute" top={centerY + 3} left={centerX - 8} fg="#FFFFFF">
        CENTER REFERENCE
      </text>

      <text position="absolute" top={5} left={centerX - 15} fg="#FFFFFF">
        HOME SCREEN · WHITE PHOSPHOR / RGB EDGE TEST
      </text>
      <text position="absolute" top={rows - 6} left={centerX - 14} fg="#ff5050">
        RED
      </text>
      <text position="absolute" top={rows - 6} left={centerX - 5} fg="#50ff50">
        GREEN
      </text>
      <text position="absolute" top={rows - 6} left={centerX + 7} fg="#5050ff">
        BLUE
      </text>

      <ScreenControls label="HOME SCREEN" screen={HOME_SCREEN} />
    </PixelRenderer>
  )
}
