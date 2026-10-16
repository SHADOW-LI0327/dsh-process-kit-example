/**
 * 登录页 / 注册页：同一张表单，按路由决定主动作。
 *
 * 注册成功即开会话（服务端下发 `sid`），随后回到「我的」；
 * 入参错误与凭据错误都直接显示服务端 `message`，前端不猜原因。
 * 从结算页被拦下来的访客会先看到一行说明：为什么要先登录。
 */
import { api, errorMessage } from '../api.mjs';
import { banner, el, pageHead } from '../components.mjs';
import { getState, loadCart, loadSession, setState } from '../state.mjs';
import { PATHS } from '../routes.mjs';

/** 与服务端同一形状的邮箱判据（`server/src/app.mjs` 的 `EMAIL_PATTERN`）；口令长度同 `PASSWORD_MIN_LENGTH`。 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

/**
 * 表单自校验：空提交 / 明显不合规的输入在本地就挡住。
 * 服务端的通用 400 是给「坏请求」的兜底（措辞面向排查，不对用户），不该端给填表的人。
 */
function formProblem(email, password) {
  if (email === '') return '请填写邮箱';
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return '邮箱格式看起来不对，请检查后重试';
  if (password === '') return '请填写密码，至少 8 位';
  if (password.length < PASSWORD_MIN_LENGTH) return `密码至少 ${PASSWORD_MIN_LENGTH} 位`;
  if (password.length > PASSWORD_MAX_LENGTH) return `密码不能超过 ${PASSWORD_MAX_LENGTH} 位`;
  return null;
}

export function renderAuth(root, { mode = 'login', error = null } = {}) {
  const { user, loginReason } = getState();
  const isRegister = mode === 'register';

  const email = el('input', {
    class: 'field__input',
    id: 'auth-email',
    name: 'email',
    type: 'email',
    autocomplete: 'username',
    placeholder: 'you@example.com',
    required: true,
  });
  const password = el('input', {
    class: 'field__input',
    id: 'auth-password',
    name: 'password',
    type: 'password',
    autocomplete: isRegister ? 'new-password' : 'current-password',
    placeholder: '至少 8 位密码',
    minlength: 8,
    required: true,
  });

  const primary = el(
    'button',
    { class: 'btn btn--cta', type: 'submit', dataset: { action: isRegister ? 'register' : 'login' } },
    [isRegister ? '注册' : '登录'],
  );

  const form = el('form', { class: 'form-card', novalidate: true }, [
    el('p', { class: 'form-card__title' }, ['登录后同步购物车与订单']),
    el('label', { class: 'field', for: 'auth-email' }, [el('span', { class: 'field__label' }, ['邮箱']), email]),
    el('label', { class: 'field', for: 'auth-password' }, [
      el('span', { class: 'field__label' }, ['密码']),
      password,
    ]),
    el('div', { class: 'actions' }, [
      primary,
      isRegister
        ? el('a', { class: 'btn', href: PATHS.login }, ['已有账号，去登录'])
        : el('a', { class: 'btn', href: PATHS.register }, ['注册新账号']),
    ]),
    el('p', { class: 'line__meta' }, ['注册需邮箱 + 密码（至少 8 位）']),
  ]);

  const submit = async (action) => {
    const problem = formProblem(email.value.trim(), password.value);
    if (problem) {
      renderAuth(root, { mode, error: problem });
      return;
    }
    primary.disabled = true;
    const idle = action === 'register' ? '注册' : '登录';
    primary.textContent = action === 'register' ? '注册中…' : '登录中…';
    try {
      if (action === 'register') await api.register(email.value.trim(), password.value);
      else await api.login(email.value.trim(), password.value);
      setState({
        error: null,
        loginReason: null,
        notice: action === 'register' ? '注册成功，已登录' : '登录成功',
      });
      await loadSession();
      await loadCart();
      location.hash = PATHS.me;
    } catch (caught) {
      primary.disabled = false;
      primary.textContent = idle;
      renderAuth(root, { mode, error: errorMessage(caught) });
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit(isRegister ? 'register' : 'login');
  });

  root.replaceChildren();
  if (error) root.append(banner(error));
  // 说明放在最前面：被结算页拦下来的人一眼知道为什么站在这里。
  if (loginReason) root.append(banner(loginReason));
  root.append(
    pageHead(isRegister ? '注册' : '登录', user ? `当前账号：${user.email}` : '未登录也可以逛商品，下单前需登录'),
    form,
  );
}
