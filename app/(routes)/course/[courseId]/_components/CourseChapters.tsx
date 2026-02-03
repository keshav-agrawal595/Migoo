import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Course } from '@/type/CourseType';
import { Player } from '@remotion/player';
import { Dot } from 'lucide-react';
import ChapterVideo from './ChapterVideo';

type Props = {
    course: Course | undefined;
}

function CourseChapters({ course }: Props) {
    return (
        <div className='max-w-6xl -mt-5 p-10 border rounded-3xl shadow-lg w-full bg-background/80 backdrop-blur-xl'>
            <div className='flex justify-between items-center'>
                <h2 className='font-bold text-2xl mb-2'>Course preview</h2>
                <h2 className='text-sm text-muted-foreground'>Chapters and Short Preview</h2>
            </div>
            <div className='mt-5 '>
                {course?.courseLayout?.chapters?.map((chapter, index) => (
                    <Card key={index} className='mb-5'>
                        <CardHeader>
                            <div className='flex items-center gap-3'>
                                <h2 className='p-2 bg-primary/40 inline-flex h-10 w-10 text-center rounded-2xl justify-center items-center'>{index + 1}</h2>
                                <CardTitle className='md:text-xl text-base '>
                                    {chapter.chapterTitle}
                                </CardTitle>
                            </div>
                        </CardHeader>

                        <CardContent>
                            <div className='grid grid-cols-2 gap-5 '>
                                <div>
                                    {chapter.subContent.map((content, index) => (
                                        <div key={index} className='flex gap-2 items-center mt-2'>
                                            <Dot className='h-5 w-5 text-primary' />
                                            <h2>{content}</h2>
                                        </div>
                                    ))}
                                </div>
                                <div>
                                    <Player
                                        component={ChapterVideo}
                                        durationInFrames={30}
                                        compositionWidth={1280}
                                        compositionHeight={720}
                                        fps={30}
                                        controls
                                        style={{
                                            width: '100%',
                                            height: '180px',
                                        }}

                                    />
                                </div>
                            </div>
                        </CardContent>

                    </Card>
                ))}
            </div>
        </div>
    )
}

export default CourseChapters