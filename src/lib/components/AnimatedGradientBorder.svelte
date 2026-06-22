<script lang="ts">
  export let gradientColors: string =
    "#4285f4, #ea4335, #fbbc05, #34a853, #4285f4";
  export let animationDuration: string = "2s";
  /** Thickness of the visible gradient ring in px or css units */
  export let ringWidth: string = "10px";
  /** Border radius of the ring — should match the window/widget corner radius */
  export let borderRadius: string = "12px";
  /** Blur applied to the gradient colors for softness within the ring */
  export let blur: string = "6px";
  export let saturation: string = "150%";
  export let isFocused: boolean = false;
  export let forceVisible: boolean = false;

  let visible = false;
  let hideTimeout: ReturnType<typeof setTimeout>;

  $: if (forceVisible) {
    visible = true;
    clearTimeout(hideTimeout);
  } else if (isFocused) {
    visible = true;
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      visible = false;
    }, 3000);
  } else {
    visible = false;
    clearTimeout(hideTimeout);
  }
</script>

<!--
  Gradient border ring using the CSS padding-box mask technique.
  
  HOW IT WORKS:
    position:fixed; inset:0  →  element covers exact viewport area
    padding: ringWidth        →  defines ring thickness
    border-radius: borderRadius → rounds the corners
    
    mask layer 1: linear-gradient(white) content-box  → opaque inside padding (interior)
    mask layer 2: linear-gradient(white)              → opaque everywhere
    -webkit-mask-composite: destination-out           → layer 2 MINUS layer 1 = only padding ring
    
    Result: only the padding border ring area is visible, center is transparent.
    No mask-composite: exclude or complex shapes needed.
    
  WHY -webkit-mask-composite: destination-out:
    Standard WebKit value for "subtract". NOT "xor" (Blink/Chrome legacy).
    destination-out = Dst × (1 - Src_alpha) where:
      Dst = full element (opaque)
      Src = content-box (opaque in interior)
      Result = opaque where Dst but NOT Src = the ring/padding area only ✓
-->
<div
  class="glow-outer {visible ? 'show' : ''}"
  style="
    --ring-width: {ringWidth};
    --ring-radius: {borderRadius};
    --gradient-colors: {gradientColors};
    --animation-duration: {animationDuration};
    --blur-amount: {blur};
    --glow-saturation: {saturation};
  "
  aria-hidden="true"
>
  <div class="glow-ring">
    <div class="gradient-spinner"></div>
  </div>
</div>

<style>
  /* ── Outer wrapper: position + opacity animation only ── */
  .glow-outer {
    position: absolute;
    inset: 0;
    z-index: 99;
    pointer-events: none;
    will-change: opacity;

    /* Apply blur here so it softens the masked ring inside */
    filter: blur(var(--blur-amount)) saturate(var(--glow-saturation));

    --breathe-hi: 0.95;
    --breathe-lo: 0.35;

    opacity: 0;
    transition: opacity 2s ease-in-out;
  }

  .glow-outer.show {
    opacity: 1;
    transition: opacity 0.5s ease-in;
  }

  :global(:root[data-theme="dark"]) .glow-outer {
    --breathe-hi: 0.9;
    --breathe-lo: 0.2;
  }

  /* ── Gradient ring: rounded-rect border using padding-box mask ── */
  .glow-ring {
    position: absolute;
    inset: 0;
    border-radius: var(--ring-radius);

    /*
     * CSS padding-box mask ring technique:
     *
     * Two mask layers:
     *   Layer A (bottom): linear-gradient white → covers FULL element
     *   Layer B (top):    linear-gradient white content-box → covers INTERIOR (inside padding)
     *
     * -webkit-mask-composite: destination-out
     *   = "show Layer A EXCEPT where Layer B covers"
     *   = "show full element EXCEPT the interior"
     *   = only the padding border ring is visible ✓
     *
     * The ring width/shape is controlled by `padding` and `border-radius`.
     */
    padding: var(--ring-width);

    -webkit-mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    -webkit-mask-composite: destination-out;

    mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    mask-composite: exclude;

    /* Breathing animation — paused by default, runs only when visible */
    animation: breathe 3s ease-in-out infinite;
    animation-play-state: paused;
  }

  .glow-outer.show .glow-ring {
    animation-play-state: running;
  }

  /* ── Spinning conic gradient that fills the ring ── */
  .gradient-spinner {
    position: absolute;
    top: 50%;
    left: 50%;
    /* Must be large enough to fill the entire glow-ring at any rotation */
    width: 200vmax;
    height: 200vmax;
    background: conic-gradient(from 0deg, var(--gradient-colors));
    transform-origin: center;
    will-change: transform;
    animation: spin var(--animation-duration) linear infinite;
    /* Pause when parent is invisible — save GPU cycles for editor rendering */
    animation-play-state: paused;
  }

  .glow-outer.show .gradient-spinner {
    animation-play-state: running;
  }

  @keyframes spin {
    from {
      transform: translate(-50%, -50%) rotate(0deg);
    }
    to {
      transform: translate(-50%, -50%) rotate(360deg);
    }
  }

  @keyframes breathe {
    0%,
    100% {
      opacity: var(--breathe-hi);
    }
    50% {
      opacity: var(--breathe-lo);
    }
  }
</style>
