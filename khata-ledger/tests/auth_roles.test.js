/**
 * tests/auth_roles.test.js
 * Unit & security tests for authentication, first-run setup,
 * password hashing, rate limiting, and Owner vs Staff permissions.
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('../src/db/index');
const { runMigrations } = require('../src/db/migrator');
const {
  needsSetup,
  setupOwner,
  login,
  createUser,
  listUsers,
  deactivateUser,
} = require('../src/services/authService');
const { loginAttempts } = require('../src/middleware/rateLimiter');

describe('Authentication, Security & Roles Tests', () => {
  let db;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    loginAttempts.clear();
  });

  test('First run check: needsSetup is true when no users exist', () => {
    assert.equal(needsSetup(db), true);
  });

  test('First run: requires strong password (min 8 chars) and creates owner', () => {
    // Attempt with short password
    assert.throws(
      () => setupOwner({ name: 'Owner', username: 'owner', password: '123' }, db),
      /at least 8 characters/
    );

    // Setup with valid credentials
    const owner = setupOwner({
      name: 'Business Owner',
      username: 'boss',
      password: 'StrongSecretPassword123!',
      business_name: 'Sharma General Store',
    }, db);

    assert.equal(owner.username, 'boss');
    assert.equal(owner.role, 'owner');
    assert.equal(needsSetup(db), false);

    // Cannot run setup a second time
    assert.throws(
      () => setupOwner({ name: 'Hacker', username: 'hacker', password: 'password123' }, db),
      /Setup has already been completed/
    );
  });

  test('Password is saved as secure hash, never in plain text', () => {
    setupOwner({
      name: 'Owner',
      username: 'owner',
      password: 'SuperSecretPassword!',
    }, db);

    const userRow = db.prepare('SELECT * FROM users WHERE username = ?').get('owner');
    assert.notEqual(userRow.password_hash, 'SuperSecretPassword!');
    assert.ok(userRow.password_hash.startsWith('$2')); // bcrypt salt identifier
  });

  test('Login authenticates with valid credentials and issues session & CSRF tokens', () => {
    setupOwner({
      name: 'Owner',
      username: 'owner',
      password: 'SuperSecretPassword!',
    }, db);

    const authRes = login('owner', 'SuperSecretPassword!', db);
    assert.ok(authRes.sessionToken);
    assert.ok(authRes.csrfToken);
    assert.equal(authRes.user.username, 'owner');
    assert.equal(authRes.user.role, 'owner');

    // Failed login with wrong password
    assert.throws(
      () => login('owner', 'WrongPassword!', db),
      /Invalid username or password/
    );
  });

  test('Owner can create staff accounts; Staff cannot create users', () => {
    const owner = setupOwner({
      name: 'Owner',
      username: 'owner',
      password: 'SuperSecretPassword!',
    }, db);

    // Owner creates staff
    const staff = createUser({
      name: 'Counter Staff',
      username: 'counter1',
      password: 'StaffSecretPassword123',
      role: 'staff',
    }, owner, db);

    assert.equal(staff.username, 'counter1');
    assert.equal(staff.role, 'staff');

    // Staff tries to create another user -> fails with FORBIDDEN
    assert.throws(
      () => createUser({
        name: 'Another Staff',
        username: 'counter2',
        password: 'Password123!',
        role: 'staff',
      }, staff, db),
      /Permission denied/
    );
  });

  test('Owner can list users and deactivate staff; cannot deactivate self', () => {
    const owner = setupOwner({
      name: 'Owner',
      username: 'owner',
      password: 'SuperSecretPassword!',
    }, db);

    const staff = createUser({
      name: 'Staff Member',
      username: 'staff1',
      password: 'StaffPassword123!',
      role: 'staff',
    }, owner, db);

    const users = listUsers(owner, db);
    assert.equal(users.length, 2);

    // Deactivate staff
    deactivateUser(staff.id, owner, db);
    const deactivatedStaff = db.prepare('SELECT is_active FROM users WHERE id = ?').get(staff.id);
    assert.equal(deactivatedStaff.is_active, 0);

    // Owner cannot deactivate self
    assert.throws(
      () => deactivateUser(owner.id, owner, db),
      /cannot deactivate your own account/
    );
  });
});
