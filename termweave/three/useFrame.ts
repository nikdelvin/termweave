import type { CliRenderer } from '@opentui/core'
import { useRenderer } from '@opentui/react'
import { useEffect, useRef } from 'react'

export type FrameCallback = (deltaTime: number) => void

export function useFrame(callback: FrameCallback) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const renderer: CliRenderer | null = useRenderer() ?? null

  useEffect(() => {
    if (!renderer) return
    const frameCallback = async (deltaTime: number) => {
      callbackRef.current(deltaTime)
    }
    renderer.setFrameCallback(frameCallback)
    renderer.requestLive()
    return () => {
      renderer.removeFrameCallback(frameCallback)
      renderer.dropLive()
    }
  }, [renderer])
}
