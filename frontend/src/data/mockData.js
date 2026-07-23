export const users = [
  { id: 1, name: 'Dianne Russell', email: 'nevaeh.simmons@example.com', birthDate: '1989/04/06', phone: '063-222-1125', image: 'Dianne Russell.png' },
  { id: 2, name: 'Leslie Alexander', email: 'curtis.weaver@example.com', birthDate: '1976/09/12', phone: '088-124-1555', image: 'Leslie Alexander.png' },
  { id: 3, name: 'Wade Warren', email: 'debbie.baker@example.com', birthDate: '1954/02/08', phone: '063-137-3355', image: 'Wade Warren.png' },
  { id: 4, name: 'Jane Cooper', email: 'nathan.roberts@example.com', birthDate: '1961/05/27', phone: '093-241-3262', image: 'Jane Cooper.png' },
  { id: 5, name: 'Bessie Cooper', email: 'debra.holt@example.com', birthDate: '1983/02/10', phone: '088-125-1671', image: 'Bessie Cooper.png' },
  { id: 6, name: 'Arlene McCoy', email: 'georgia.young@example.com', birthDate: '1969/03/05', phone: '082-141-2567', image: 'Arlene McCoy.png' },
  { id: 7, name: 'Theresa Webb', email: 'jessica.hanson@example.com', birthDate: '1983/02/10', phone: '095-242-1144', image: 'Theresa Webb.png' },
  { id: 8, name: 'Darrell Steward', email: 'dolores.chambers@example.com', birthDate: '1989/04/06', phone: '093-424-1253', image: 'Darrell Steward.png' },
  { id: 9, name: 'Courtney Henry', email: 'michael.mitc@example.com', birthDate: '1990/12/14', phone: '088-172-3113', image: 'Courtney Henry.png' },
  { id: 10, name: 'Savannah Nguyen', email: 'willie.jennings@example.com', birthDate: '1970/11/09', phone: '081-632-1256', image: 'Savannah Nguyen.png' },
];

const productPrices = ['$6,000', '$5,000', '$40,000', '$12,000', '$45,000', '$15,000', '$8,000', '$80,000', '$35,000', '$20,000'];
const productStocks = [1, 3, 6, 355, 42, 45, 144, 677, 533, 532];

export const products = productPrices.map((price, index) => ({
  id: index + 1,
  name: `Sản phẩm ${index + 1}`,
  price,
  stock: productStocks[index],
  description: 'Lorem ipsum dolor sit amet',
  image: `P${index + 1}.png`,
}));
