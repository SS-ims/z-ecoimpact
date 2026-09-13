// scripts/main.js
// Main interactions: nav toggle, reel drag+swipe with inertia, cart via API,
// contact email/database delivery (POST /api/chat), checkout (POST /api/checkout), location (GET /api/location)

document.addEventListener('DOMContentLoaded', function () {

  // Normalize social links on static pages to match the index footer.
  const socialLinks = {
    // Keep placeholder LinkedIn anchors on the other pages pointed at the raw profile URL.
    linkedin: 'https://www.linkedin.com/in/zecoimpact-consulting-services/',
    whatsapp: 'https://wa.me/258877768890? text=I%20am%20enquiring%20about%20Zecoimpactconsulting',
    instagram: 'https://www.instagram.com/zecoimpactconsulting/',
    facebook: 'https://www.facebook.com/profile.php?id=61593383057833'
  };
  document.querySelectorAll('.footer-social a').forEach((link) => {
    const network = link.getAttribute('aria-label')?.toLowerCase();
    if (network && socialLinks[network]) {
      link.href = socialLinks[network];
      if (network === 'linkedin') {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    }
  });

  // NAV TOGGLE for small screens
  const sideNav = document.querySelector('.side-nav');
  const main = document.querySelector('.main');
  const toggle = document.getElementById('menu-toggle');

  let overlay = document.getElementById('nav-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'nav-overlay';
    overlay.className = 'nav-overlay';
    document.body.appendChild(overlay);
  }

  function setNavState(isOpen) {
    if (!sideNav) return;
    const mobile = window.innerWidth <= 900;
    const mobileNavOpen = isOpen && mobile;
    // Keep the navigation visible on desktop; only hide it while the mobile menu is closed.
    sideNav.classList.toggle('hidden', !isOpen && mobile);
    sideNav.classList.toggle('open', mobileNavOpen);
    if (main) {
      main.classList.toggle('full', !isOpen && mobile);
    }
    overlay.classList.toggle('visible', mobileNavOpen);
    // Show a close icon while the mobile navigation is open and the hamburger otherwise.
    if (toggle) {
      toggle.textContent = mobileNavOpen ? '×' : '☰';
      toggle.setAttribute('aria-label', mobileNavOpen ? 'Fechar menu' : 'Abrir menu');
    }
  }

  if (toggle) {
    toggle.addEventListener('click', () => {
      const isOpen = !sideNav?.classList.contains('open');
      setNavState(isOpen);
    });
  }

  overlay.addEventListener('click', () => setNavState(false));

  sideNav?.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 900) {
        setNavState(false);
      }
    });
  });

  window.addEventListener('resize', () => {
    const shouldOpen = sideNav?.classList.contains('open');
    setNavState(shouldOpen && window.innerWidth <= 900);
  });

  // ---------------------------
  // REEL: drag / swipe + inertia
  // ---------------------------
  const reel = document.querySelector('.reel');
  const leftBtn = document.getElementById('reel-left');
  const rightBtn = document.getElementById('reel-right');

  if (reel) {
    let isDown = false;
    let startX = 0;
    let currentTranslate = 0;      // current transformX value (positive value = moved left)
    let prevTranslate = 0;
    let velocity = 0;
    let lastTime = 0;
    let rafId = null;
    const clampMax = () => {
      // maximum translate based on total width minus container width
      const container = reel.parentElement;
      const totalWidth = reel.scrollWidth;
      const visible = container.clientWidth;
      return Math.max(0, totalWidth - visible);
    };

    function setTranslate(x) {
      // clamp
      const max = clampMax();
      currentTranslate = Math.max(0, Math.min(x, max));
      reel.style.transform = `translateX(-${currentTranslate}px)`;
    }

    function animateInertia() {
      // friction
      velocity *= 0.95;
      if (Math.abs(velocity) < 0.02) {
        velocity = 0;
        cancelAnimationFrame(rafId);
        rafId = null;
        return;
      }
      setTranslate(currentTranslate + velocity);
      rafId = requestAnimationFrame(animateInertia);
    }

    // Pointer / touch start
    const pointerDown = (clientX) => {
      isDown = true;
      startX = clientX;
      prevTranslate = currentTranslate;
      velocity = 0;
      lastTime = performance.now();
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    };
    const pointerMove = (clientX) => {
      if (!isDown) return;
      const dx = clientX - startX;
      const now = performance.now();
      const dt = Math.max(1, now - lastTime);
      // invert dx: dragging left should move reel right (increase translate)
      const next = prevTranslate - dx;
      // compute velocity (px per frame)
      velocity = (currentTranslate - next) / (dt / 16.66); // normalized
      setTranslate(next);
      lastTime = now;
    };
    const pointerUp = () => {
      if (!isDown) return;
      isDown = false;
      // start inertia if velocity present
      if (Math.abs(velocity) > 0.5) {
        // limit velocity magnitude
        velocity = Math.max(-60, Math.min(60, velocity));
        rafId = requestAnimationFrame(animateInertia);
      } else {
        velocity = 0;
      }
    };

    // Mouse events
    reel.addEventListener('mousedown', (e) => {
      e.preventDefault();
      pointerDown(e.clientX);
    });
    window.addEventListener('mousemove', (e) => pointerMove(e.clientX));
    window.addEventListener('mouseup', pointerUp);

    // Touch events
    reel.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      pointerDown(t.clientX);
    }, { passive: true });
    reel.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      pointerMove(t.clientX);
    }, { passive: true });
    reel.addEventListener('touchend', pointerUp);

    // Buttons fallback (also reset velocity)
    if (rightBtn) rightBtn.addEventListener('click', () => { setTranslate(currentTranslate + 336); velocity = 0; });
    if (leftBtn) leftBtn.addEventListener('click', () => { setTranslate(Math.max(0, currentTranslate - 336)); velocity = 0; });
  }

  // ---------------------------
  // CART functionality (API)
  // ---------------------------
  const cartList = document.getElementById('cart-list');
  const cartCountElems = [document.getElementById('cart-count'), document.getElementById('cart-count-small')].filter(Boolean);

  async function fetchCart() {
    const res = await fetch('/api/cart');
    return res.json();
  }

  function setCartCount(items) {
    const count = items.reduce((sum, item) => sum + item.qty, 0);
    cartCountElems.forEach(el => { if (el) el.textContent = count || ''; });
  }

  async function renderCart() {
    try {
      const data = await fetchCart();
      const items = data.items || [];
      setCartCount(items);
      if (!cartList) return;
      cartList.innerHTML = '';
      if (items.length === 0) {
        cartList.innerHTML = '<div style="padding:12px;color:#666">Cart is empty</div>';
        return;
      }
      items.forEach(item => {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.gap = '8px';
        div.style.alignItems = 'center';
        div.style.padding = '8px 0';
        div.innerHTML = `<img src="/${item.image}" style="width:60px;height:40px;object-fit:cover;border-radius:6px">
          <div style="flex:1"><strong>${item.name}</strong><div style="color:#666;font-size:13px">$${item.price.toFixed(2)}</div></div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <div>
              <button class="qty-decr" data-id="${item.productId}">−</button>
              <span style="padding:0 8px">${item.qty}</span>
              <button class="qty-incr" data-id="${item.productId}">+</button>
            </div>
            <button data-id="${item.productId}" class="remove">Remove</button>
          </div>`;
        cartList.appendChild(div);
      });

      cartList.querySelectorAll('.remove').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.target.dataset.id;
          await fetch('/api/cart/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: id })
          });
          renderCart();
        });
      });
      cartList.querySelectorAll('.qty-incr').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.target.dataset.id;
          const item = (await fetchCart()).items.find(i => i.productId === id);
          if (!item) return;
          await fetch('/api/cart/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: id, qty: item.qty + 1 })
          });
          renderCart();
        });
      });
      cartList.querySelectorAll('.qty-decr').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.target.dataset.id;
          const item = (await fetchCart()).items.find(i => i.productId === id);
          if (!item) return;
          await fetch('/api/cart/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: id, qty: Math.max(1, item.qty - 1) })
          });
          renderCart();
        });
      });
    } catch (err) {
      console.error('Failed to load cart', err);
    }
  }
  renderCart();

  async function addToCart(productId, button) {
    await fetch('/api/cart/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, qty: 1 })
    });
    await renderCart();
    if (button) {
      const original = button.textContent;
      button.textContent = 'Added ✓';
      setTimeout(() => button.textContent = original, 900);
    }
  }

  document.querySelectorAll('.add-to-cart').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset.id, btn));
  });

  document.querySelectorAll('.detail-add-to-cart').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset.id, btn));
  });

  // ---------------------------
  // Chat widget - toggle and send to /api/chat (server proxy)
  // ---------------------------
  const chatToggle = document.getElementById('chat-toggle');
  const chatWindow = document.getElementById('chat-window');
  const closeBtn = document.getElementById('chat-close');
  const sendBtn = document.getElementById('chat-send');
  const input = document.getElementById('chat-input');
  const messages = document.getElementById('chat-messages');

  if (chatToggle) {
    chatToggle.addEventListener('click', () => {
      if (chatWindow) chatWindow.classList.toggle('hidden');
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', () => chatWindow.classList.add('hidden'));
  }

  function appendMessage(text, cls) {
    if (!messages) return;
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  // initial welcome
  setTimeout(() => appendMessage("Hello! I'm Z Ecoimpact Assist — how can I help you today?", 'bot'), 350);

  async function sendMessage() {
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    appendMessage(val, 'user');
    input.value = '';
    appendMessage('...', 'bot');
    try {
      // call backend proxy at /api/chat
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: val })
      });
      const data = await res.json();
      // replace last '...' with real reply
      const botMsgs = Array.from(messages.querySelectorAll('.msg.bot'));
      const last = botMsgs[botMsgs.length - 1];
      if (last) last.textContent = data.reply || 'Sorry, no response';
      else appendMessage(data.reply || 'Sorry, no response', 'bot');
    } catch (e) {
      appendMessage('Sorry — chat service is unavailable.', 'bot');
    }
  }

  if (sendBtn) sendBtn.addEventListener('click', sendMessage);
  if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendMessage(); });

  // ---------------------------
  // Checkout (API)
  // ---------------------------
  const checkoutForm = document.getElementById('checkout-form');
  const checkoutResult = document.getElementById('checkout-result');
  if (checkoutForm) {
    checkoutForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const formData = new FormData(checkoutForm);
      const payload = Object.fromEntries(formData.entries());
      try {
        const res = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
          checkoutResult.textContent = data.message || 'Checkout failed.';
          return;
        }
        checkoutResult.textContent = `Order placed. Confirmation #${data.purchaseId}.`;
        checkoutForm.reset();
        renderCart();
      } catch (err) {
        console.error(err);
        checkoutResult.textContent = 'Checkout request failed.';
      }
    });
  }

  // ---------------------------
  // Location (API)
  // ---------------------------
  const locationInfo = document.getElementById('location-info');
  if (locationInfo) {
    fetch('/api/location')
      .then(res => res.json())
      .then(data => {
        locationInfo.innerHTML = `
          <h3>${data.name}</h3>
          <p>${data.address}</p>
          <p><strong>Phone:</strong> ${data.phone}</p>
          <p><strong>Hours:</strong> ${data.hours}</p>
          <a href="${data.mapUrl}" target="_blank" rel="noopener">Open map</a>
        `;
      })
      .catch(() => {
        locationInfo.textContent = 'Location information unavailable.';
      });
  }

  // ---------------------------
  // Submit contact messages to the server so they are stored in the active database.
  // ---------------------------
  const contactForm = document.getElementById('contact-form');
  const contactResult = document.getElementById('contact-result');
  if (contactForm) {
    contactForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const submitButton = contactForm.querySelector('button[type="submit"]');
      if (submitButton) submitButton.disabled = true;
      if (contactResult) contactResult.textContent = 'A enviar...';

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(contactForm)))
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to send message');
        if (contactResult) contactResult.textContent = data.reply;
        contactForm.reset();
      } catch (error) {
        // Display the server response so users know when their message was
        // saved even if email delivery needs configuration or retries.
        if (contactResult) contactResult.textContent = error.message || 'Não foi possível enviar a mensagem. Tente novamente.';
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
  }

});
