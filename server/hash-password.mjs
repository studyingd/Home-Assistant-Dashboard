import { hashPassword } from './security.mjs';

const password = process.argv[2];
if (!password) {
  console.error('用法: node server/hash-password.mjs "至少12位的强密码"');
  process.exitCode = 1;
} else {
  console.log(await hashPassword(password));
}
