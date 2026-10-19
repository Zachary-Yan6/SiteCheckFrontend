import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { Chip } from './Chip';

describe('Chip', () => {
  it('calls onPress when tapped', async () => {
    const onPress = jest.fn();
    await render(<Chip label="30 days" selected={false} onPress={onPress} />);

    await fireEvent.press(screen.getByText('30 days'));

    expect(onPress).toHaveBeenCalled();
  });

  it('looks selected when selected, and faded when disabled', async () => {
    await render(<Chip label="Cork" selected onPress={() => {}} />);
    expect(screen.getByText('Cork')).toHaveStyle({ color: '#fff' });

    await screen.rerender(<Chip label="Cork" selected={false} disabled onPress={() => {}} />);
    expect(screen.getByText('Cork')).toBeDisabled();
    expect(screen.getByText('Cork').parent).toHaveStyle({ opacity: 0.4 });
  });
});
