// The insurers WCA sends RFQs to, and who to write to at each, from the
// office sheet "Insurance compay with Mail id -Employee.xlsx".
//
// The sheet marks each row Motor, No-Motor, or Motor/non motor. A row for
// both simply lists the same people under each group. Names are the sheet's,
// with spelling and capitalisation tidied only.

const split = (s) => s.split('/').map((e) => e.trim().toLowerCase()).filter(Boolean);

const both = (name, emails) => ({ name, motor: split(emails), nonMotor: split(emails) });

export const INSURER_CONTACTS = [
  {
    name: 'ICICI Lombard',
    motor: split('utkarsh.malik@icicilombard.com/jagdish.chaudhari@icicilombard.com/milind.patel@icicilombard.com'),
    nonMotor: split('ajaysinh.rathod@icicilombard.com/amit.pat@icicilombard.com/jagdish.chaudhari@icicilombard.com'),
  },
  {
    name: 'Tata AIG',
    motor: split('aftabhusain1.Vhora@tataaig.com/Patelnidhi.teamlease@tataaig.com/Solankisapaben.teamlease@gmail.com'),
    nonMotor: split('vivan.desai@tataaig.com/Manan.Goswami@tataaig.com'),
  },
  both('Future Generali', 'devangkumar.padhiyar@generalicentral.com/sharikkhan.pathan@generalicentral.com'),
  both('Go Digit', 'jainil.lodariya@godigit.com/Vishwanath.Dalvi@godigit.com/hardik.pandya@godigit.com/krunal.rana@godigit.com'),
  both('Reliance', 'SACHIN.SU.PANDEY@indusindinsurance.com/SALIMSHA.DIWAN@indusindinsurance.com'),
  both('Bajaj', 'Dharmendrakumar.P02@BajajGeneral.com/arpan.jain02@bajajgeneral.com'),
  both('Good Broker', 'thakar@good.in/dinesh@good.in'),
  both('Magma', 'manish.pareek@magmainsurance.com/nilesh.khristi@magmainsurance.com'),
  { name: 'PB Bazaar', motor: [], nonMotor: split('dipalthakkar@pbpartners.com/dharmeshpurohit@pbpartners.com') },
  both('National Insurance', 'alpesh.rohit@nic.co.in/paresh.parmar@nic.co.in'),
  both('The New India Assurance', 'pradip.kumar@newindia.co.in'),
];
