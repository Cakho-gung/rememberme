<script lang="ts">
  // Màu mặc định kiểu Google Gemini
  export let gradientColors: string = '#4285f4, #ea4335, #fbbc05, #34a853, #4285f4';
  export let animationDuration: string = '2s';
  
  // Độ dày của viền phát sáng (thật dày theo ý bạn)
  export let glowWidth: string = '8px';
  
  export let blur: string = '40px';
  
  // Độ rực rỡ của màu (tăng lên 150% - 200% để màu đậm hơn sau khi bị blur)
  export let saturation: string = '100%';
  
  // Trigger animation khi focus
  export let isFocused: boolean = false;
  
  // Hiển thị liên tục không bị mất đi (cho đến khi false)
  export let forceVisible: boolean = false;
  
  export let style: string = '';

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

<div 
  class="glow-wrapper {visible ? 'show' : ''}"
  style="
    --blur-amount: {blur};
    --glow-saturation: {saturation};
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
    z-index: 100;
    pointer-events: none;
    
    /* Cấu hình mặc định cho Light Mode */
    --breathe-opacity-high: 0.8;
    --breathe-opacity-low: 0.4;
    --breathe-brightness-high: 1.4;
    --breathe-brightness-low: 0.6;
    
    /* Blur mạnh để viền màu loang ra đều các hướng. 
       Việc tách riêng class wrapper giúp ép trình duyệt phải render mask trước rồi mới blur. */
    filter: blur(var(--blur-amount)) saturate(var(--glow-saturation));
    
    opacity: 0;
    transform: scale(0.98); /* Bắt đầu nhỏ hơn một chút */
    transition: opacity 2s ease-in-out, transform 2s ease-in-out;
  }

  .glow-wrapper.show {
    opacity: 1;
    transform: scale(1); /* Phóng to ra kích thước thật */
    transition: opacity 0.5s ease-in, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  }

  /* Ghi đè thông số dịu hơn cho Dark Mode */
  :global(:root[data-theme="dark"]) .glow-wrapper {
    --breathe-opacity-high: 0.8;
    --breathe-opacity-low: 0.2;
    --breathe-brightness-high: 1;
    --breathe-brightness-low: 0.5;
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
    
    /* Chạy nhịp thở liên tục, độc lập với transition ẩn/hiện */
    animation: breathe 3s ease-in-out infinite;
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

  @keyframes breathe {
    0%, 100% {
      transform: scale(1.04);
      opacity: var(--breathe-opacity-high);
      filter: brightness(var(--breathe-brightness-high));
    }
    50% {
      transform: scale(0.96);
      opacity: var(--breathe-opacity-low);
      filter: brightness(var(--breathe-brightness-low));
    }
  }
</style>
