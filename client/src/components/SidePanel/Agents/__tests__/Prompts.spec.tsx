import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AgentPrompts from '../Prompts';

const access = { isTarsUser: true, canUsePrompts: true };

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useHasAccess: () => access.canUsePrompts,
}));

jest.mock('~/hooks/Tars/useTarsChatPrompts', () => ({
  useIsTarsLinkedUser: () => access.isTarsUser,
}));

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

const renderSection = (agentId?: string) =>
  render(
    <MemoryRouter initialEntries={['/c/new']}>
      <Routes>
        <Route path="/c/new" element={<AgentPrompts agent_id={agentId} />} />
        <Route path="*" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  );

const addButton = () => screen.getByRole('button', { name: 'com_agents_tars_prompts_add_aria' });

describe('Agent builder prompts section', () => {
  afterEach(() => {
    access.isTarsUser = true;
    access.canUsePrompts = true;
  });

  it("opens a saved agent's prompts page", async () => {
    const user = userEvent.setup();
    renderSection('agent_a');

    expect(screen.getByText('com_agents_tars_prompts_label')).toBeInTheDocument();
    expect(screen.queryByText('com_agents_tars_prompts_disabled')).not.toBeInTheDocument();
    await user.click(addButton());

    expect(screen.getByTestId('location')).toHaveTextContent('/prompts/agent/agent_a');
  });

  it('keeps adding off until the agent is saved', () => {
    renderSection(undefined);

    expect(addButton()).toBeDisabled();
    expect(screen.getByText('com_agents_tars_prompts_disabled')).toBeInTheDocument();
  });

  it('is hidden from accounts that have no pwc_tars prompts', () => {
    access.isTarsUser = false;
    renderSection('agent_a');
    expect(screen.queryByText('com_agents_tars_prompts_label')).not.toBeInTheDocument();
  });

  it('is hidden from roles that may not use prompts', () => {
    access.canUsePrompts = false;
    renderSection('agent_a');
    expect(screen.queryByText('com_agents_tars_prompts_label')).not.toBeInTheDocument();
  });
});
