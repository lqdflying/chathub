import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { StateCreator } from 'zustand/vanilla';

import { createDevtools } from '@/store/middleware/createDevtools';

import { SkillAction, createSkillSlice } from './action';
import { SkillStoreState, initialState } from './initialState';

export interface SkillStore extends SkillAction, SkillStoreState {}

const createStore: StateCreator<SkillStore, [['zustand/devtools', never]]> = (...params) => ({
  ...initialState,
  ...createSkillSlice(...params),
});

export const useSkillStore = createWithEqualityFn<SkillStore>()(
  createDevtools('skill')(createStore),
  shallow,
);

export const getSkillStoreState = () => useSkillStore.getState();
