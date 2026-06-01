<script lang="ts">
  // Màu mặc định kiểu Google Gemini
  export let gradientColors: string = '#4285f4, #ea4335, #fbbc05, #34a853, #4285f4';
  export let animationDuration: string = '3s';
  
  // Độ dày của viền phát sáng (thật dày theo ý bạn)
  export let glowWidth: string = '8px';
  
  export let blur: string = '40px';
  
  // Trigger animation khi focus
  export let isFocused: boolean = false;
  
  export let style: string = '';

  let visible = false;
  let hideTimeout: ReturnType<typeof setTimeout>;

  $: if (isFocused) {
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

<div 
  class="glow-wrapper {visible ? 'show' : ''}"
  style="
    --blur-amount: {blur};
    {style}
  "
>
  <div 
    class="glow-border-container"
    style="
      --glow-width: {glowWidth};
      --gradient-colors: {gradientColors};
      --animation-duration: {animationDuration};
    "
  >
    <div class="gradient-bg"></div>
  </div>
</div>

<style>
  .glow-wrapper {
    position: absolute;
    inset: 0;
    z-index: 10;
    pointer-events: none;
    
    /* Blur mạnh để viền màu loang ra đều các hướng. 
       Việc tách riêng class wrapper giúp ép trình duyệt phải render mask trước rồi mới blur. */
    filter: blur(var(--blur-amount));
    
    opacity: 0;
    transform: scale(0.98); /* Bắt đầu nhỏ hơn một chút */
    transition: opacity 2s ease-in-out, transform 2s ease-in-out;
  }

  .glow-wrapper.show {
    opacity: 1;
    transform: scale(1); /* Phóng to ra kích thước thật */
    transition: opacity 0.5s ease-out, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .glow-border-container {
    position: absolute;
    inset: 0;
    
    /* Bắt đầu với độ dày viền = 0px để tạo hiệu ứng viền nở ra */
    padding: 0px;
    transition: padding 2s ease-in-out;
    
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    
    border-radius: inherit;
  }

  .glow-wrapper.show .glow-border-container {
    padding: var(--glow-width); /* Nở ra đúng độ dày gốc */
    transition: padding 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .gradient-bg {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 150vmax;
    height: 150vmax;
    background: conic-gradient(
      from 0deg,
      var(--gradient-colors)
    );
    animation: spin var(--animation-duration) linear infinite;
    transform-origin: center;
    opacity: 1;
  }

  @keyframes spin {
    from {
      transform: translate(-50%, -50%) rotate(0deg);
    }
    to {
      transform: translate(-50%, -50%) rotate(360deg);
    }
  }
</style>
