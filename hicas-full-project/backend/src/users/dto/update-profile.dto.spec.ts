import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateProfileDto } from './update-profile.dto';

describe(UpdateProfileDto.name, () => {
  it('allows only nonblank editable values and explicit null clears', async () => {
    await expect(
      validate(
        plainToInstance(UpdateProfileDto, {
          fullName: '  Nguyen Van A  ',
          phone: null,
          birthDate: null,
        }),
      ),
    ).resolves.toEqual([]);

    const dto = plainToInstance(UpdateProfileDto, { fullName: null, phone: '   ' });
    await expect(validate(dto)).resolves.toHaveLength(2);
  });

  it('enforces the calendar-date syntax before the service checks the calendar itself', async () => {
    const dto = plainToInstance(UpdateProfileDto, { birthDate: '31/01/1990' });

    await expect(validate(dto)).resolves.toHaveLength(1);
  });
});
