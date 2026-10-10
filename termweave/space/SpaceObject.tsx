/** @jsxImportSource @opentui/react */
import { Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, type DataTexture } from 'three'
import { useEffect, useMemo, useRef } from 'react'
import { ThreeRenderer, type ThreeRenderableAdapter, type ThreeRendererProps } from '../three/ThreeRenderer'
import { toDataTexture, updateDataTexture } from './pixels'
import { renderSpaceObject, type SpaceObjectConfig } from './space-objects'
import {
  BACKGROUND_FILL,
  BACKGROUND_HEIGHT,
  BACKGROUND_WIDTH,
  renderBackground,
} from './background'

export interface SpaceObjectProps {
  object: SpaceObjectConfig
  backgroundSeed?: number
  width?: ThreeRendererProps['width']
  height?: ThreeRendererProps['height']
  onReady?: (renderable: ThreeRenderableAdapter) => void
  onError?: (message: string) => void
}

export function SpaceObject({
  object,
  backgroundSeed,
  width = '100%',
  height = '100%',
  onReady,
  onError,
}: SpaceObjectProps) {
  const { scene, camera, objectMaterial, objectMesh, backgroundTexture, dispose } = useMemo(() => {
    const scene = new Scene()
    const camera = new OrthographicCamera(
      -BACKGROUND_WIDTH / 2,
      BACKGROUND_WIDTH / 2,
      BACKGROUND_HEIGHT / 2,
      -BACKGROUND_HEIGHT / 2,
      0.1,
      100,
    )
    camera.position.z = 20
    const backgroundTexture = toDataTexture(backgroundFiller())
    const backgroundMaterial = new MeshBasicMaterial({ map: backgroundTexture })
    const backgroundMesh = new Mesh(
      new PlaneGeometry(BACKGROUND_WIDTH, BACKGROUND_HEIGHT),
      backgroundMaterial,
    )
    scene.add(backgroundMesh)
    const objectMaterial = new MeshBasicMaterial({ transparent: true })
    const objectMesh = new Mesh(new PlaneGeometry(1, 1), objectMaterial)
    objectMesh.position.z = 10
    scene.add(objectMesh)
    let sceneDisposed = false
    return {
      scene,
      camera,
      objectMaterial,
      objectMesh,
      backgroundTexture,
      dispose: () => {
        if (sceneDisposed) return
        sceneDisposed = true
        backgroundMesh.geometry.dispose()
        safeDispose(backgroundTexture)
        safeDispose(backgroundMaterial)
        objectMesh.geometry.dispose()
        if (objectMaterial.map) safeDispose(objectMaterial.map)
        safeDispose(objectMaterial)
      },
    }
  }, [])

  const objectMeshRef = useRef(objectMesh)
  objectMeshRef.current = objectMesh
  const objectMaterialRef = useRef(objectMaterial)
  objectMaterialRef.current = objectMaterial
  const objectTextureRef = useRef<DataTexture | null>(null)
  const renderableRef = useRef<ThreeRenderableAdapter | null>(null)
  const requestRender = () => {
    const renderable = renderableRef.current
    if (renderable && !renderable.isDestroyed) renderable.requestRender()
  }

  useEffect(() => {
    const material = objectMaterialRef.current
    const buffer = renderSpaceObject(object)
    objectMeshRef.current.scale.set(buffer.width, buffer.height, 1)
    const current = objectTextureRef.current
    if (!current || current.image.width !== buffer.width) {
      if (current) safeDispose(current)
      const texture = toDataTexture(buffer)
      objectTextureRef.current = texture
      material.map = texture
      material.needsUpdate = true
    } else {
      updateDataTexture(current, buffer)
    }
    requestRender()
  }, [object])

  useEffect(() => {
    updateDataTexture(backgroundTexture, backgroundFiller())
    requestRender()
    let cancelled = false
    renderBackground(backgroundSeed).then((buffer) => {
      if (!cancelled) {
        updateDataTexture(backgroundTexture, buffer)
        requestRender()
      }
    })
    return () => {
      cancelled = true
    }
  }, [backgroundSeed, backgroundTexture])

  useEffect(() => {
    return () => dispose()
  }, [dispose])

  return (
    <ThreeRenderer
      scene={scene}
      camera={camera}
      live={false}
      width={width}
      height={height}
      onReady={(renderable) => {
        renderableRef.current = renderable
        onReady?.(renderable)
      }}
      onError={onError}
    />
  )
}

function safeDispose(resource: { dispose(): void }) {
  try {
    resource.dispose()
  } catch {}
}

function backgroundFiller() {
  const data = new Uint8Array(BACKGROUND_WIDTH * BACKGROUND_HEIGHT * 4)
  const [r, g, b] = BACKGROUND_FILL
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = Math.round(r * 255)
    data[offset + 1] = Math.round(g * 255)
    data[offset + 2] = Math.round(b * 255)
    data[offset + 3] = 255
  }
  return { width: BACKGROUND_WIDTH, height: BACKGROUND_HEIGHT, data }
}
