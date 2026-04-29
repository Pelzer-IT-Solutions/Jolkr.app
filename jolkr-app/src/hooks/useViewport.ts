import { useEffect, useState } from 'react'

export type ViewportRegime = 'wide' | 'tablet' | 'compact' | 'mobile'

export interface Viewport {
  regime: ViewportRegime
  isWide: boolean      // >= 1024
  isTablet: boolean    // <  1024
  isCompact: boolean   // <   768
  isMobile: boolean    // <   600
}

const BP_TABLET  = 1024
const BP_COMPACT =  768
const BP_MOBILE  =  600

function getRegime(width: number): ViewportRegime {
  if (width < BP_MOBILE)  return 'mobile'
  if (width < BP_COMPACT) return 'compact'
  if (width < BP_TABLET)  return 'tablet'
  return 'wide'
}

function getViewport(width: number): Viewport {
  return {
    regime: getRegime(width),
    isWide:    width >= BP_TABLET,
    isTablet:  width <  BP_TABLET,
    isCompact: width <  BP_COMPACT,
    isMobile:  width <  BP_MOBILE,
  }
}

const SSR_DEFAULT: Viewport = {
  regime: 'wide',
  isWide: true,
  isTablet: false,
  isCompact: false,
  isMobile: false,
}

// Bail-out via regime check: only re-renders consumers when crossing a
// breakpoint, so per-pixel resize within a regime stays cheap.
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => {
    if (typeof window === 'undefined') return SSR_DEFAULT
    return getViewport(window.innerWidth)
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    let raf = 0
    const update = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setVp(prev => {
          const next = getViewport(window.innerWidth)
          if (prev.regime === next.regime) return prev
          return next
        })
      })
    }
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      cancelAnimationFrame(raf)
    }
  }, [])

  return vp
}
