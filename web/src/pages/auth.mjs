/**
 * 登录 / 注册页（同一张表单，两个动作）。
 *
 * 注册成功即开会话（服务端下发 `sid`），随后回到「我的」；
 * 入参错误与凭据错误都直接显示服务端 `message`，前端不猜原因。
 */
import { api, errorMessage } from '../api.mjs';
import { banner, el, pageHead } from '../components.mjs';
import { getState, loadCart, loadSession, setState } from '../state.mjs';
import { PATHS } from '../routes.mjs';

export function renderAuth(root, { error = null } = {}) {
  const user = getState().user;

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
    autocomplete: 'current-password',
    placeholder: '至少 8 位口令',
    minlength: 8,
    required: true,
  });

  const form = el('form', { class: 'form-card', novalidate: true }, [
    el('label', { class: 'field', for: 'auth-email' }, [el('span', { class: 'field__label' }, ['邮箱']), email]),
    el('label', { class: 'field', for: 'auth-password' }, [
      el('span', { class: 'field__label' }, ['口令']),
      password,
    ]),
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn btn--cta', type: 'submit', dataset: { action: 'login' } }, ['登录']),
      el('button', { class: 'btn', type: 'button', dataset: { action: 'register' } }, ['注册新账号']),
    ]),
  ]);

  const submit = async (action, button) => {
    button.disabled = true;
    try {
      if (action === 'register') await api.register(email.value.trim(), password.value);
      else await api.login(email.value.trim(), password.value);
      setState({ error: null, notice: action === 'register' ? '注册成功，已登录' : '登录成功' });
      await loadSession();
      await loadCart();
      location.hash = PATHS.me;
    } catch (caught) {
      button.disabled = false;
      renderAuth(root, { error: errorMessage(caught) });
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit('login', form.querySelector('button[type="submit"]'));
  });
  form.querySelector('button[data-action="register"]').addEventListener('click', (event) => {
    event.preventDefault();
    submit('register', event.currentTarget);
  });

  root.replaceChildren();
  if (error) root.append(banner(error));
  root.append(
    pageHead('登录 / 注册', user ? `当前账号：${user.email}` : '账号用于把购物车与订单归到你名下'),
    form,
  );
}
