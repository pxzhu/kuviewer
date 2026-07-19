import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceListRequestCoordinator } from './resourceListRequestCoordinator.ts';

test('starting a primary request invalidates older primary and page requests', () => {
  const coordinator = new ResourceListRequestCoordinator();
  const firstPrimary = coordinator.beginPrimary();
  const firstPage = coordinator.beginPage();

  assert.equal(coordinator.isCurrent(firstPrimary), true);
  assert.equal(coordinator.isCurrent(firstPage), true);

  const secondPrimary = coordinator.beginPrimary();
  assert.equal(firstPrimary.signal.aborted, true);
  assert.equal(firstPage.signal.aborted, true);
  assert.equal(coordinator.isCurrent(firstPrimary), false);
  assert.equal(coordinator.isCurrent(firstPage), false);
  assert.equal(coordinator.isCurrent(secondPrimary), true);
});

test('a newer page request aborts an older page without invalidating its generation', () => {
  const coordinator = new ResourceListRequestCoordinator();
  const primary = coordinator.beginPrimary();
  assert.equal(coordinator.finish(primary), true);

  const firstPage = coordinator.beginPage();
  const secondPage = coordinator.beginPage();

  assert.equal(firstPage.signal.aborted, true);
  assert.equal(coordinator.isCurrent(firstPage), false);
  assert.equal(coordinator.isCurrent(secondPage), true);
  assert.equal(secondPage.generation, primary.generation);
  assert.equal(coordinator.finish(secondPage), true);
  assert.equal(coordinator.finish(secondPage), false);
});

test('generation cleanup cancels pagination after the primary request has completed', () => {
  const coordinator = new ResourceListRequestCoordinator();
  const primary = coordinator.beginPrimary();
  assert.equal(coordinator.finish(primary), true);

  const page = coordinator.beginPage();
  assert.equal(coordinator.cancelGeneration(primary.generation), true);
  assert.equal(page.signal.aborted, true);
  assert.equal(coordinator.isCurrent(page), false);
  assert.equal(coordinator.cancelGeneration(primary.generation), false);
});

test('explicit invalidation prevents late request completion from becoming current', () => {
  const coordinator = new ResourceListRequestCoordinator();
  const primary = coordinator.beginPrimary();
  const page = coordinator.beginPage();

  coordinator.invalidate();

  assert.equal(primary.signal.aborted, true);
  assert.equal(page.signal.aborted, true);
  assert.equal(coordinator.finish(primary), false);
  assert.equal(coordinator.finish(page), false);
});
