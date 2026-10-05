export const BIDI_NOTIFICATION_KEY = 'bidi.content.notification.disable'

// Unicode RTL scripts and explicit RTL embedding/override/isolate controls.
const RTL_TEXT = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\p{Script=Yezidi}\p{Script=Old_Hungarian}\p{Script=Phoenician}\p{Script=Imperial_Aramaic}\p{Script=Palmyrene}\p{Script=Nabataean}\p{Script=Hatran}\p{Script=Old_North_Arabian}\p{Script=Old_South_Arabian}\p{Script=Avestan}\p{Script=Inscriptional_Parthian}\p{Script=Inscriptional_Pahlavi}\p{Script=Psalter_Pahlavi}\p{Script=Manichaean}\p{Script=Mende_Kikakui}\p{Script=Old_Turkic}\p{Script=Sogdian}\p{Script=Old_Sogdian}\p{Script=Elymaic}\p{Script=Chorasmian}\u200f\u202b\u202e\u2067]/u

export function containsBidirectionalText(text: string): boolean {
  return RTL_TEXT.test(text)
}

export function showBidiNotification(contains: boolean, hidden: boolean, disabled: boolean): boolean {
  return contains && !hidden && !disabled
}
